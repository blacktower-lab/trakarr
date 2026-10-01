import type { Config, Rule } from "./config.ts";
import { ConnectionError, type TestResult } from "./connection.ts";
import {
  announcesTo,
  formatRatio,
  matches,
  nextState,
  plan,
  ratioOf,
  totals,
  type Held,
  type LedgerEntry,
  type RuleState,
  type Torrent,
} from "./engine.ts";
import type { Log } from "./log.ts";
import { createProwlarr } from "./prowlarr.ts";
import { applyMaindata, createQbit, emptySnapshot, torrentsOf, type Qbit } from "./qbit.ts";
import type { AppliedSwitch, EventKind, Store, StoredState } from "./store.ts";

// The loop that watches qBittorrent: on every poll it reads what changed,
// updates each rule's ratio and state, and holds or releases downloads.

export const HOLD_TAG = "trakarr-hold";

// A throttled torrent downloads at 1 KiB/s, so it keeps announcing and
// uploading the pieces it has, which helps the ratio recover.
export const THROTTLE_BYTES = 1024;

interface Transition {
  rule: Rule;
  state: RuleState;
  ratio: number;
}

export function createWatcher({ config, store, log }: { config: Config; store: Store; log: Log }) {
  const ledger = store.ledger();
  const states = store.ruleStates();
  const held = store.held();
  // What test mode would hold. Only in memory, since nothing was changed.
  let testHeld = new Map<string, Held>();
  let wasTestMode: boolean | null = null;

  let qbit: Qbit | null = null;
  let qbitSettings = "";
  let snapshot = emptySnapshot();
  let torrents = new Map<string, Torrent>();
  let connection: TestResult = { ok: false, reason: "unreachable", message: "Not polled yet" };
  let lastUpdate: number | null = null;
  // The domains the torrents in qBittorrent announce to.
  let domains = new Set<string>();

  // Failures are logged when they start, not again on every poll they repeat.
  let failures = new Set<string>();
  let failing = new Set<string>();

  // A new client, and a new full snapshot, whenever the connection settings change.
  function client(): Qbit {
    const settings = config.settings().qbittorrent;
    const key = JSON.stringify(settings);
    if (!qbit || key !== qbitSettings) {
      qbit = createQbit(settings);
      qbitSettings = key;
      snapshot = emptySnapshot();
      connection = { ok: false, reason: "unreachable", message: "Not polled yet" };
    }
    return qbit;
  }

  async function tick() {
    failing = new Set();
    try {
      endFreeleech();
      await poll();
    } finally {
      failures = failing;
    }
  }

  async function poll() {
    const qb = client();
    const started = Date.now();
    const connecting = !connection.ok;
    try {
      const data = await qb.maindata(snapshot.rid);
      if (!connection.ok) setConnection({ ok: true, version: await qb.version() });
      applyMaindata(snapshot, data);
      log.debug("qbit", "sync/maindata", {
        rid: data.rid,
        changed: Object.keys(data.torrents ?? {}).length,
        ms: Date.now() - started,
      });
    } catch (error) {
      if (!(error instanceof ConnectionError)) throw error;
      // Nothing is held or released on missing data.
      setConnection({ ok: false, reason: error.reason, message: error.message });
      return;
    }
    torrents = torrentsOf(snapshot);
    const previous = lastUpdate;
    lastUpdate = Date.now();
    noteTrackers(connecting);

    updateLedger(freeSince(previous, lastUpdate));
    const rules = config.rules();
    const { testMode } = config.settings();
    const transitions = evaluate(rules);
    await act(qb, rules, transitions, testMode);
    if (!testMode) await switchProfiles(rules);
  }

  function setConnection(next: TestResult) {
    const { address } = config.settings().qbittorrent;
    if (next.ok && !connection.ok) log.info("qbit", "Connected to qBittorrent", { address, version: next.version });
    if (!next.ok && (connection.ok || connection.message !== next.message)) {
      // A fresh install has no address yet, which is no failure.
      if (address.trim() === "") log.info("qbit", "qBittorrent isn't set up yet, waiting for its address in Settings");
      else log.warn("qbit", `${next.message}, skipping polls until it's back`, { address });
      if (connection.ok) event("error", `Lost qBittorrent: ${next.message}`);
    }
    connection = next;
  }

  // The trackers are all logged once qBittorrent connects, and then as they
  // come and go with the torrents that announce to them.
  function noteTrackers(connected: boolean) {
    const next = new Set([...torrents.values()].flatMap((t) => t.domains));
    if (connected) {
      log.info("qbit", "Found trackers", { trackers: next.size, torrents: torrents.size });
      log.debug("qbit", "Trackers", { domains: [...next].sort().join(", ") });
    } else {
      const added = [...next].filter((domain) => !domains.has(domain));
      const gone = [...domains].filter((domain) => !next.has(domain));
      if (added.length > 0) log.info("qbit", "Found new trackers", { domains: added.join(", ") });
      if (gone.length > 0) log.info("qbit", "No torrent announces to these trackers anymore", { domains: gone.join(", ") });
    }
    domains = next;
  }

  // A freeleech that's over is dropped, even while qBittorrent is away, and
  // the tracker goes back to its rule.
  function endFreeleech() {
    const now = Date.now();
    const trackers = config.trackers();
    const ended = trackers.filter((tracker) => tracker.freeleech && tracker.freeleech.until <= now);
    if (ended.length === 0) return;
    config.saveTrackers(trackers.map((tracker) => (ended.includes(tracker) ? { ...tracker, freeleech: null } : tracker)));
    for (const { domain } of ended) {
      log.info("engine", "Freeleech ended", { tracker: domain });
      event("tracker", `The freeleech on ${domain} ended`);
    }
  }

  // The trackers on a freeleech for the whole time since the last poll, whose
  // downloads in that time don't count. A poll that crosses the start or the
  // end counts as usual, and so does the first one after a restart: trakarr
  // would rather see a ratio a little low than one too high.
  function freeSince(previous: number | null, now: number): string[] {
    if (previous === null) return [];
    return config
      .trackers()
      .filter(({ freeleech }) => freeleech && freeleech.from <= previous && now <= freeleech.until)
      .map(({ domain }) => domain);
  }

  // The trackers on a freeleech right now, whose torrents aren't held.
  function onFreeleech(): string[] {
    const now = Date.now();
    return config
      .trackers()
      .filter(({ freeleech }) => freeleech && freeleech.from <= now && now < freeleech.until)
      .map(({ domain }) => domain);
  }

  // Keeps the last totals of every torrent seen, and moves those of removed
  // torrents to `past`, where they still count. What a torrent on a freeleech
  // downloaded since the last poll adds to what doesn't count. A torrent that
  // announces to two trackers, one on a freeleech, is free for both.
  function updateLedger(free: string[]) {
    const changed: LedgerEntry[] = [];
    for (const t of torrents.values()) {
      const entry = ledger.get(t.hash);
      if (
        entry &&
        !entry.removed &&
        entry.uploaded === t.uploaded &&
        entry.downloaded === t.downloaded &&
        same(entry.tags, t.tags) &&
        same(entry.domains, t.domains)
      ) {
        continue;
      }
      // A removed entry's totals moved to `past`, so this life starts from zero.
      const downloaded = Math.max(0, t.downloaded - (entry?.downloaded ?? 0));
      const next: LedgerEntry = {
        hash: t.hash,
        tags: t.tags,
        domains: t.domains,
        uploaded: t.uploaded,
        downloaded: t.downloaded,
        pastUploaded: entry?.pastUploaded ?? 0,
        pastDownloaded: entry?.pastDownloaded ?? 0,
        removed: false,
        freeDownloaded: (entry?.freeDownloaded ?? 0) + (announcesTo(t, free) ? downloaded : 0),
      };
      ledger.set(t.hash, next);
      changed.push(next);
    }
    for (const entry of ledger.values()) {
      if (entry.removed || torrents.has(entry.hash)) continue;
      entry.pastUploaded += entry.uploaded;
      entry.pastDownloaded += entry.downloaded;
      entry.uploaded = 0;
      entry.downloaded = 0;
      entry.removed = true;
      changed.push(entry);
    }
    store.putLedger(changed);
  }

  function evaluate(rules: Rule[]): Transition[] {
    const now = Date.now();
    const transitions: Transition[] = [];
    for (const rule of rules) {
      const stored = states.get(rule.id) ?? { state: "ok", since: now, prowlarr: null };
      if (!states.has(rule.id)) saveState(rule.id, stored);
      // A paused rule keeps its state, and goes on from it when resumed.
      if (!rule.enabled) continue;
      const { uploaded, downloaded } = totals(rule, ledger.values(), config.trackers());
      const ratio = ratioOf(uploaded, downloaded);
      const state = nextState(stored.state, ratio, rule);
      if (state === stored.state) continue;
      saveState(rule.id, { ...stored, state, since: now });
      transitions.push({ rule, state, ratio });
    }
    // A deleted rule's state goes with it, unless its indexer still has to go
    // back to its usual profile.
    for (const [id, stored] of [...states]) {
      if (rules.some((rule) => rule.id === id) || switched(stored.prowlarr)) continue;
      states.delete(id);
      store.deleteRuleState(id);
    }
    return transitions;
  }

  function saveState(ruleId: string, state: StoredState) {
    states.set(ruleId, state);
    store.setRuleState(ruleId, state);
  }

  async function act(qb: Qbit, rules: Rule[], transitions: Transition[], testMode: boolean) {
    // Test mode starts from what is really held, so it doesn't report it as new.
    if (testMode && wasTestMode !== true) testHeld = new Map(held);
    wasTestMode = testMode;
    const current = testMode ? testHeld : held;
    if (!testMode) adoptStrays();

    const ruleStates = new Map([...states].map(([id, stored]) => [id, stored.state]));
    const { hold, release, gone } = plan(rules, ruleStates, torrents, current, onFreeleech());
    for (const hash of gone) current.delete(hash);
    if (!testMode) store.deleteHeld(gone);

    const released = await releaseAll(qb, release, testMode);
    const holds = new Map<string, number>();
    for (const [ruleId, list] of hold) {
      const rule = rules.find((r) => r.id === ruleId);
      if (rule) holds.set(ruleId, await holdAll(qb, rule, list, testMode));
    }

    // One event per change of state, and one per rule for holds and releases
    // that came without one: new downloads, a paused rule, a changed match.
    const verb = (did: string, would: string) => (testMode ? would : did);
    for (const { rule, state, ratio } of transitions) {
      if (state === "held") {
        const n = holds.get(rule.id) ?? 0;
        const what = n ? ` and ${verb("held", "would hold")} ${downloads(n)}` : ", with nothing downloading";
        event("hold", `${rule.name} fell to ${formatRatio(ratio)}${what}`, testMode);
      } else {
        const n = released.filter((h) => h.ruleId === rule.id).length;
        const what = n ? ` and ${verb("released", "would release")} ${downloads(n)}` : ", with nothing held";
        event("release", `${rule.name} reached ${formatRatio(ratio)}${what}`, testMode);
      }
      if (testMode && rule.prowlarr) {
        log.info("prowlarr", "Would change the indexer's sync profile", { rule: rule.name, indexer: rule.prowlarr.indexerId });
      }
    }
    const transitioned = new Set(transitions.map(({ rule }) => rule.id));
    for (const [ruleId, n] of holds) {
      if (transitioned.has(ruleId) || n === 0) continue;
      const name = rules.find((r) => r.id === ruleId)?.name;
      const what = n === 1 ? "a new download" : `${n} new downloads`;
      event("hold", `${name} ${verb("held", "would hold")} ${what} on arrival`, testMode);
    }
    const others = Map.groupBy(
      released.filter((h) => !transitioned.has(h.ruleId)),
      (h) => h.ruleId,
    );
    for (const [ruleId, list] of others) {
      const name = rules.find((r) => r.id === ruleId)?.name;
      const what = downloads(list.length);
      event(
        "release",
        name
          ? `${name} ${verb("released", "would release")} ${what} it no longer holds`
          : `${verb("Released", "Would release")} ${what} no rule holds`,
        testMode,
      );
    }
  }

  // Torrents with trakarr's tag that it has no record of, say after the
  // database was lost. They count as held, so they're released unless a rule
  // holds them.
  function adoptStrays() {
    const now = Date.now();
    const strays: Held[] = [...torrents.values()]
      .filter((t) => t.tags.includes(HOLD_TAG) && !held.has(t.hash))
      .map((t) => ({
        hash: t.hash,
        ruleId: "",
        name: t.name,
        action: t.state === "stoppedDL" ? "stop" : "throttle",
        dlLimit: -1,
        at: now,
      }));
    if (strays.length === 0) return;
    store.putHeld(strays);
    for (const h of strays) held.set(h.hash, h);
    log.warn("engine", "Found tagged torrents with no record, taking them over", { tag: HOLD_TAG, torrents: strays.length });
  }

  async function holdAll(qb: Qbit, rule: Rule, list: Torrent[], testMode: boolean): Promise<number> {
    const now = Date.now();
    const entries: Held[] = list.map((t) => ({
      hash: t.hash,
      ruleId: rule.id,
      name: t.name,
      action: rule.action,
      // A limit equal to trakarr's own is a leftover of an earlier hold, not the user's.
      dlLimit: t.dlLimit === THROTTLE_BYTES ? -1 : t.dlLimit,
      at: now,
    }));
    const hashes = entries.map((h) => h.hash);
    const throttle = rule.action === "throttle";
    const fields = { rule: rule.name, torrents: entries.length, ...(throttle && { limit: "1 KiB/s" }) };

    if (testMode) {
      for (const h of entries) testHeld.set(h.hash, h);
      log.info("actions", throttle ? "Would set download limit" : "Would stop downloads", fields);
      return entries.length;
    }

    // Saved first, so a crash right after the change still knows what to restore.
    store.putHeld(entries);
    for (const h of entries) held.set(h.hash, h);
    try {
      if (throttle) await qb.setDownloadLimit(hashes, THROTTLE_BYTES);
      else await qb.stop(hashes);
    } catch (error) {
      store.deleteHeld(hashes);
      for (const h of entries) held.delete(h.hash);
      failed("actions", `${rule.name} couldn't hold ${downloads(entries.length)}`, error);
      return 0;
    }
    log.info("actions", throttle ? "Set download limit" : "Stopped downloads", fields);
    try {
      await qb.addTag(hashes, HOLD_TAG);
      log.info("actions", "Added tag", { tag: HOLD_TAG, torrents: entries.length });
    } catch (error) {
      // The tag only marks the hold; the record in the database is what counts.
      failed("actions", `Couldn't add the ${HOLD_TAG} tag`, error);
    }
    return entries.length;
  }

  async function releaseAll(qb: Qbit, entries: Held[], testMode: boolean): Promise<Held[]> {
    if (entries.length === 0) return [];
    const hashes = entries.map((h) => h.hash);

    if (testMode) {
      for (const hash of hashes) testHeld.delete(hash);
      log.info("actions", "Would release downloads", { torrents: entries.length });
      return entries;
    }

    // Every step is safe to repeat, so a release that fails halfway is simply
    // tried again on the next poll.
    try {
      const throttled = Map.groupBy(
        entries.filter((h) => h.action === "throttle"),
        (h) => h.dlLimit,
      );
      for (const [limit, list] of throttled) await qb.setDownloadLimit(list.map((h) => h.hash), limit);
      const stopped = entries.filter((h) => h.action === "stop").map((h) => h.hash);
      if (stopped.length > 0) await qb.start(stopped);
      await qb.removeTag(hashes, HOLD_TAG);
    } catch (error) {
      failed("actions", `Couldn't release ${downloads(entries.length)}`, error);
      return [];
    }
    store.deleteHeld(hashes);
    for (const hash of hashes) held.delete(hash);
    log.info("actions", "Released downloads", { torrents: entries.length, tag: HOLD_TAG });
    return entries;
  }

  // Puts each rule's indexer on the sync profile its state asks for. A switch
  // that moved to another indexer or went away, with its rule or on its own, is
  // undone first. What fails is tried again on the next poll.
  async function switchProfiles(rules: Rule[]) {
    for (const [ruleId, stored] of [...states]) {
      const rule = rules.find((r) => r.id === ruleId);
      const name = rule?.name ?? "A deleted rule";
      let applied = stored.prowlarr;
      const target: AppliedSwitch | null = rule?.prowlarr
        ? {
            indexerId: rule.prowlarr.indexerId,
            profileId: rule.enabled && stored.state === "held" ? rule.prowlarr.heldProfileId : rule.prowlarr.restoreProfileId,
            restoreProfileId: rule.prowlarr.restoreProfileId,
          }
        : null;
      if (applied && applied.indexerId !== target?.indexerId) {
        if (switched(applied) && !(await setProfile(name, applied.indexerId, applied.restoreProfileId))) continue;
        applied = null;
      }
      // An indexer trakarr never switched is on its usual profile already.
      if (target && applied?.profileId !== target.profileId && (applied || switched(target))) {
        if (!(await setProfile(name, target.indexerId, target.profileId))) continue;
      }
      applied = target;
      if (JSON.stringify(applied) === JSON.stringify(stored.prowlarr)) continue;
      if (rule) saveState(ruleId, { ...stored, prowlarr: applied });
      else {
        states.delete(ruleId);
        store.deleteRuleState(ruleId);
      }
    }
  }

  async function setProfile(name: string, indexerId: number, profileId: number): Promise<boolean> {
    try {
      await createProwlarr(config.settings().prowlarr).setProfile(indexerId, profileId);
    } catch (error) {
      failed("prowlarr", `${name} couldn't change the indexer's sync profile`, error);
      return false;
    }
    log.info("prowlarr", "Changed the indexer's sync profile", { rule: name, indexer: indexerId, profile: profileId });
    return true;
  }

  function failed(scope: string, message: string, error: unknown) {
    if (!(error instanceof ConnectionError)) throw error;
    const text = `${message}: ${error.message}`;
    failing.add(text);
    if (failures.has(text)) return;
    log.error(scope, message, { error: error.message });
    event("error", text);
  }

  function event(kind: EventKind, text: string, testMode = false) {
    store.addEvent({ kind, text, testMode });
  }

  function status() {
    const { testMode, pollSeconds, qbittorrent } = config.settings();
    const current = testMode && wasTestMode ? testHeld : held;
    const rules = config.rules();
    const quotas = config.trackers();
    return {
      qbittorrent: { ...connection, address: qbittorrent.address, lastUpdate },
      pollSeconds,
      testMode,
      rules: rules.map((rule) => ({
        id: rule.id,
        state: states.get(rule.id)?.state ?? "ok",
        ...preview(rule),
      })),
      // Every tracker the torrents in qBittorrent announce to, with what it
      // reaches, the first rule whose domains take it in, and its quota.
      trackers: [...domains].sort().map((domain) => {
        const quota = quotas.find((q) => q.domain === domain);
        return {
          domain,
          ruleId: rules.find((rule) => matches({ tags: [], domains: rule.domains }, [], [domain]))?.id ?? null,
          ...preview({ tags: [], domains: [domain] }),
          bought: quota?.bought ?? 0,
          freeleech: quota?.freeleech ?? null,
        };
      }),
      held: [...current.values()].map((h) => ({
        hash: h.hash,
        ruleId: h.ruleId,
        name: h.name,
        progress: torrents.get(h.hash)?.progress ?? null,
        at: h.at,
      })),
    };
  }

  // What a set of tags and domains reaches: how many torrents in qBittorrent,
  // and the totals the ledger keeps for them, removed torrents included, as
  // their trackers count them.
  function preview(match: Pick<Rule, "tags" | "domains">) {
    let count = 0;
    for (const t of torrents.values()) if (matches(match, t.tags, t.domains)) count++;
    return { torrents: count, ...totals(match, ledger.values(), config.trackers()) };
  }

  let running = false;
  let busy = false;
  let again = false;
  let timer: NodeJS.Timeout | undefined;

  // One poll at a time: the next one is scheduled when the last one ends, so a
  // slow poll never overlaps the next.
  async function run() {
    clearTimeout(timer);
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      await tick();
    } catch (error) {
      log.error("engine", "Poll failed", { error: (error as Error).message });
    } finally {
      busy = false;
    }
    if (!running) return;
    if (again) {
      again = false;
      void run();
      return;
    }
    timer = setTimeout(run, config.settings().pollSeconds * 1000);
  }

  return {
    start() {
      running = true;
      void run();
    },
    stop() {
      running = false;
      clearTimeout(timer);
    },
    // Polls right away, after a rule or a setting changed.
    poke() {
      if (running) void run();
    },
    tick,
    status,
    preview,
  };
}

export type Watcher = ReturnType<typeof createWatcher>;

// Whether an indexer is off its usual profile.
function switched(applied: AppliedSwitch | null): boolean {
  return applied !== null && applied.profileId !== applied.restoreProfileId;
}

function same(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function downloads(n: number): string {
  return n === 1 ? "1 download" : `${n} downloads`;
}
