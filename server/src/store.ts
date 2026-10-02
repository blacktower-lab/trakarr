import { DatabaseSync } from "node:sqlite";
import type { Held, LedgerEntry, RuleState } from "./engine.ts";
import type { Fields, Level } from "./log.ts";

// trakarr.db, for what trakarr writes by itself: logs, events, the dashboard's
// sessions and the state the engine needs across restarts. Rules and settings live in JSON files.

export type EventKind = "hold" | "release" | "rule" | "tracker" | "settings" | "error";

export interface TrakarrEvent {
  id: number;
  at: number;
  kind: EventKind;
  text: string;
  testMode: boolean;
}

export interface LogLine {
  id: number;
  at: number;
  level: Level;
  scope: string;
  message: string;
  fields: Fields | null;
}

export interface StoredState {
  state: RuleState;
  since: number;
  // The Prowlarr sync profile trakarr last set, and where it goes back to.
  prowlarr: AppliedSwitch | null;
}

export interface AppliedSwitch {
  indexerId: number;
  profileId: number;
  restoreProfileId: number;
}

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY, at INTEGER NOT NULL, level TEXT NOT NULL, scope TEXT NOT NULL,
    message TEXT NOT NULL, fields TEXT
  );
  CREATE INDEX IF NOT EXISTS logs_at ON logs (at);
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
    test_mode INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rule_state (
    rule_id TEXT PRIMARY KEY, state TEXT NOT NULL, since INTEGER NOT NULL, prowlarr TEXT
  );
  CREATE TABLE IF NOT EXISTS held (
    hash TEXT PRIMARY KEY, rule_id TEXT NOT NULL, name TEXT NOT NULL, action TEXT NOT NULL,
    dl_limit INTEGER NOT NULL, at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ledger (
    hash TEXT PRIMARY KEY, tags TEXT NOT NULL, domains TEXT NOT NULL,
    uploaded INTEGER NOT NULL, downloaded INTEGER NOT NULL,
    past_uploaded INTEGER NOT NULL, past_downloaded INTEGER NOT NULL, removed INTEGER NOT NULL,
    free_downloaded INTEGER NOT NULL DEFAULT 0
  );
`;

type Row = Record<string, unknown>;

export function openStore(path: string) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  // Databases from before freeleech have no column for it yet.
  const ledgerColumns = db.prepare("PRAGMA table_info(ledger)").all() as Row[];
  if (!ledgerColumns.some((column) => column.name === "free_downloaded")) {
    db.exec("ALTER TABLE ledger ADD COLUMN free_downloaded INTEGER NOT NULL DEFAULT 0");
  }

  const statements = {
    addLog: db.prepare("INSERT INTO logs (at, level, scope, message, fields) VALUES (?, ?, ?, ?, ?)"),
    pruneLogs: db.prepare("DELETE FROM logs WHERE at < ?"),
    addEvent: db.prepare("INSERT INTO events (at, kind, text, test_mode) VALUES (?, ?, ?, ?)"),
    events: db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?"),
    addSession: db.prepare("INSERT INTO sessions (token_hash, expires) VALUES (?, ?)"),
    session: db.prepare("SELECT expires FROM sessions WHERE token_hash = ?"),
    deleteSession: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
    deleteSessions: db.prepare("DELETE FROM sessions"),
    pruneSessions: db.prepare("DELETE FROM sessions WHERE expires <= ?"),
    setState: db.prepare("INSERT OR REPLACE INTO rule_state (rule_id, state, since, prowlarr) VALUES (?, ?, ?, ?)"),
    deleteState: db.prepare("DELETE FROM rule_state WHERE rule_id = ?"),
    putHeld: db.prepare("INSERT OR REPLACE INTO held (hash, rule_id, name, action, dl_limit, at) VALUES (?, ?, ?, ?, ?, ?)"),
    deleteHeld: db.prepare("DELETE FROM held WHERE hash = ?"),
    putLedger: db.prepare(
      "INSERT OR REPLACE INTO ledger (hash, tags, domains, uploaded, downloaded, past_uploaded, past_downloaded, removed, free_downloaded) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ),
  };

  function transaction(run: () => void) {
    db.exec("BEGIN");
    try {
      run();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    addLog(line: Omit<LogLine, "id">) {
      statements.addLog.run(line.at, line.level, line.scope, line.message, line.fields ? JSON.stringify(line.fields) : null);
    },

    // The newest lines at or above a level, oldest first. `before` pages back
    // by id, and `after` tails what came in since the last line seen.
    logs({
      levels,
      query,
      before,
      after = 0,
      limit,
    }: {
      levels: Level[];
      query: string;
      before: number;
      after?: number;
      limit: number;
    }): LogLine[] {
      const rows = db
        .prepare(
          `SELECT * FROM logs WHERE level IN (${levels.map(() => "?").join(", ")}) AND id < ? AND id > ?
           AND instr(lower(message || ' ' || coalesce(fields, '')), lower(?)) > 0
           ORDER BY id DESC LIMIT ?`,
        )
        .all(...levels, before, after, query, limit) as Row[];
      return rows.reverse().map((row) => ({
        id: row.id as number,
        at: row.at as number,
        level: row.level as Level,
        scope: row.scope as string,
        message: row.message as string,
        fields: row.fields ? (JSON.parse(row.fields as string) as Fields) : null,
      }));
    },

    // Drops the log lines older than the given number of days.
    pruneLogs(days: number) {
      statements.pruneLogs.run(Date.now() - days * 24 * 60 * 60 * 1000);
    },

    addEvent(event: Omit<TrakarrEvent, "id" | "at">) {
      statements.addEvent.run(Date.now(), event.kind, event.text, event.testMode ? 1 : 0);
    },

    events(limit: number): TrakarrEvent[] {
      return (statements.events.all(limit) as Row[]).map((row) => ({
        id: row.id as number,
        at: row.at as number,
        kind: row.kind as EventKind,
        text: row.text as string,
        testMode: row.test_mode === 1,
      }));
    },

    // A session is kept as the hash of its token, and lasts until `expires`.
    addSession(tokenHash: string, expires: number) {
      statements.addSession.run(tokenHash, expires);
    },

    sessionExpires(tokenHash: string): number | undefined {
      return (statements.session.get(tokenHash) as { expires: number } | undefined)?.expires;
    },

    deleteSession(tokenHash: string) {
      statements.deleteSession.run(tokenHash);
    },

    deleteSessions() {
      statements.deleteSessions.run();
    },

    pruneSessions(now: number) {
      statements.pruneSessions.run(now);
    },

    ruleStates(): Map<string, StoredState> {
      const rows = db.prepare("SELECT * FROM rule_state").all() as Row[];
      return new Map(
        rows.map((row) => [
          row.rule_id as string,
          {
            state: row.state as RuleState,
            since: row.since as number,
            prowlarr: row.prowlarr ? (JSON.parse(row.prowlarr as string) as AppliedSwitch) : null,
          },
        ]),
      );
    },

    setRuleState(ruleId: string, { state, since, prowlarr }: StoredState) {
      statements.setState.run(ruleId, state, since, prowlarr ? JSON.stringify(prowlarr) : null);
    },

    deleteRuleState(ruleId: string) {
      statements.deleteState.run(ruleId);
    },

    held(): Map<string, Held> {
      const rows = db.prepare("SELECT * FROM held").all() as Row[];
      return new Map(
        rows.map((row) => [
          row.hash as string,
          {
            hash: row.hash as string,
            ruleId: row.rule_id as string,
            name: row.name as string,
            action: row.action as Held["action"],
            dlLimit: row.dl_limit as number,
            at: row.at as number,
          },
        ]),
      );
    },

    putHeld(entries: Held[]) {
      transaction(() => {
        for (const h of entries) statements.putHeld.run(h.hash, h.ruleId, h.name, h.action, h.dlLimit, h.at);
      });
    },

    deleteHeld(hashes: string[]) {
      transaction(() => {
        for (const hash of hashes) statements.deleteHeld.run(hash);
      });
    },

    ledger(): Map<string, LedgerEntry> {
      const rows = db.prepare("SELECT * FROM ledger").all() as Row[];
      return new Map(
        rows.map((row) => [
          row.hash as string,
          {
            hash: row.hash as string,
            tags: JSON.parse(row.tags as string) as string[],
            domains: JSON.parse(row.domains as string) as string[],
            uploaded: row.uploaded as number,
            downloaded: row.downloaded as number,
            pastUploaded: row.past_uploaded as number,
            pastDownloaded: row.past_downloaded as number,
            removed: row.removed === 1,
            freeDownloaded: row.free_downloaded as number,
          },
        ]),
      );
    },

    putLedger(entries: LedgerEntry[]) {
      if (entries.length === 0) return;
      transaction(() => {
        for (const e of entries) {
          statements.putLedger.run(
            e.hash,
            JSON.stringify(e.tags),
            JSON.stringify(e.domains),
            e.uploaded,
            e.downloaded,
            e.pastUploaded,
            e.pastDownloaded,
            e.removed ? 1 : 0,
            e.freeDownloaded,
          );
        }
      });
    },

    close() {
      db.close();
    },
  };
}

export type Store = ReturnType<typeof openStore>;
