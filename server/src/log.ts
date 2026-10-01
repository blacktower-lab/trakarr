import type { Store } from "./store.ts";

export const LEVELS = ["debug", "info", "warn", "error"] as const;

export type Level = (typeof LEVELS)[number];

export type Fields = Record<string, string | number | boolean | null>;

// Fields whose values never reach a log line, whatever passes them.
const SECRET = /pass|key|secret|token|cookie/i;

// Each line goes to the database, for the Logs page, and to the console.
export function createLog(store: Store, minLevel: Level = "info", print = true) {
  const min = LEVELS.indexOf(minLevel);

  function write(level: Level, scope: string, message: string, fields?: Fields) {
    if (LEVELS.indexOf(level) < min) return;
    const safe = fields && Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, SECRET.test(k) ? "<redacted>" : v]));
    const at = Date.now();
    store.addLog({ at, level, scope, message, fields: safe ?? null });
    if (!print) return;
    const extra = safe ? Object.entries(safe).map(([k, v]) => ` ${k}=${v}`).join("") : "";
    const line = `${new Date(at).toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${extra}`;
    if (level === "warn" || level === "error") console.error(line);
    else console.log(line);
  }

  return {
    debug: (scope: string, message: string, fields?: Fields) => write("debug", scope, message, fields),
    info: (scope: string, message: string, fields?: Fields) => write("info", scope, message, fields),
    warn: (scope: string, message: string, fields?: Fields) => write("warn", scope, message, fields),
    error: (scope: string, message: string, fields?: Fields) => write("error", scope, message, fields),
  };
}

export type Log = ReturnType<typeof createLog>;
