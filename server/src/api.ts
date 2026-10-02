import { randomUUID } from "node:crypto";
import { join } from "node:path";
import express, { type ErrorRequestHandler } from "express";
import {
  parseMatch,
  parseQuotaChange,
  parseRule,
  parseSettings,
  publicSettings,
  ValidationError,
  type Config,
  type Rule,
  type Settings,
} from "./config.ts";
import { ConnectionError, test, type TestResult } from "./connection.ts";
import { LEVELS, type Fields, type Level, type Log } from "./log.ts";
import { createProwlarr } from "./prowlarr.ts";
import { createQbit } from "./qbit.ts";
import type { EventKind, Store } from "./store.ts";
import type { Watcher } from "./watcher.ts";

// The built app, served from the same port.
const APP_DIST = join(import.meta.dirname, "../../app/dist");

const HOUR = 60 * 60 * 1000;
const GIB = 1024 ** 3;

interface Deps {
  config: Config;
  store: Store;
  log: Log;
  watcher: Watcher;
}

export function createApi({ config, store, log, watcher }: Deps) {
  const app = express();
  const api = express.Router();
  app.use(express.json());

  // Everything the UI does is logged. Saved changes also go to the events, with
  // what changed in the log line, and the watcher looks at them right away.
  function changed(kind: EventKind, text: string, fields: Fields) {
    store.addEvent({ kind, text, testMode: false });
    log.info("api", text, fields);
    watcher.poke();
  }

  function tested(service: string, address: string, result: TestResult) {
    if (result.ok) log.info("api", `Connection test to ${service} passed`, { address, version: result.version });
    else log.warn("api", `Connection test to ${service} failed`, { address, error: result.message });
  }

  function noSuchRule(req: express.Request, res: express.Response) {
    log.warn("api", "No such rule", { request: `${req.method} ${req.originalUrl}` });
    res.status(404).json({ error: "No such rule" });
  }

  api.get("/status", (_req, res) => {
    res.json(watcher.status());
  });

  api.get("/rules", (_req, res) => {
    res.json(config.rules());
  });

  api.post("/rules", (req, res) => {
    const rule = parseRule(req.body, randomUUID());
    config.saveRules([...config.rules(), rule]);
    changed("rule", `${rule.name} rule added`, ruleFields(rule));
    res.status(201).json(rule);
  });

  // Takes the fields to change: a paused rule, for example, only sends `enabled`.
  api.patch("/rules/:id", (req, res) => {
    const old = config.rules().find((rule) => rule.id === req.params.id);
    if (!old) {
      noSuchRule(req, res);
      return;
    }
    const rule = parseRule({ ...old, ...req.body }, old.id);
    config.saveRules(config.rules().map((r) => (r.id === old.id ? rule : r)));
    const what = old.enabled === rule.enabled ? "edited" : rule.enabled ? "resumed" : "paused";
    changed("rule", `${rule.name} rule ${what}`, changes(ruleFields(old), ruleFields(rule)));
    res.json(rule);
  });

  api.delete("/rules/:id", (req, res) => {
    const old = config.rules().find((rule) => rule.id === req.params.id);
    if (!old) {
      noSuchRule(req, res);
      return;
    }
    config.saveRules(config.rules().filter((rule) => rule.id !== old.id));
    changed("rule", `${old.name} rule deleted`, ruleFields(old));
    res.status(204).end();
  });

  // The rule editor's live count and totals of what a match reaches. It runs
  // as the match is typed, so it's only logged at debug.
  api.post("/rules/preview", (req, res) => {
    const match = parseMatch(req.body);
    const preview = watcher.preview(match);
    log.debug("api", "Previewed a match", {
      tags: match.tags.join(", "),
      domains: match.domains.join(", "),
      torrents: preview.torrents,
    });
    res.json(preview);
  });

  // Changes what a tracker's site counts that qBittorrent doesn't: upload
  // bought with bonus points, added a purchase at a time, and a freeleech. It
  // also pins the tracker to the top of the dashboard, or unpins it.
  api.patch("/trackers/:domain", (req, res) => {
    const change = parseQuotaChange(req.params.domain, req.body);
    const { domain } = change;
    const trackers = config.trackers();
    const old = trackers.find((tracker) => tracker.domain === domain) ?? { domain, bought: 0, freeleech: null, pinned: false };
    const bought = old.bought + change.addBought;
    if (bought < 0) throw new ValidationError("That takes back more upload than was bought");
    const now = Date.now();
    const hours = change.freeleechHours;
    const freeleech = hours === undefined ? old.freeleech : hours === null ? null : { from: now, until: now + hours * HOUR };
    const pinned = change.pinned ?? old.pinned;
    const next = { domain, bought, freeleech, pinned };
    config.saveTrackers(
      trackers.some((tracker) => tracker.domain === domain)
        ? trackers.map((tracker) => (tracker.domain === domain ? next : tracker))
        : [...trackers, next],
    );

    if (change.addBought !== 0) {
      const what = `${formatGiB(Math.abs(change.addBought))} of bought upload`;
      changed("tracker", change.addBought > 0 ? `Added ${what} to ${domain}` : `Took back ${what} from ${domain}`, {
        bought: `${formatGiB(old.bought)} → ${formatGiB(bought)}`,
      });
    }
    if (freeleech && hours) {
      changed("tracker", `Freeleech on ${domain} for ${hours}h`, { until: new Date(freeleech.until).toISOString() });
    } else if (!freeleech && old.freeleech) {
      changed("tracker", `Ended the freeleech on ${domain}`, { until: new Date(old.freeleech.until).toISOString() });
    }
    if (pinned !== old.pinned) {
      changed("tracker", `${pinned ? "Pinned" : "Unpinned"} ${domain}`, { pinned: `${old.pinned} → ${pinned}` });
    }
    res.json(next);
  });

  api.get("/events", (req, res) => {
    res.json(store.events(Math.min(count(req.query.limit, 50), 1000)));
  });

  // Lines at `level` or above, oldest first, matching `q`; `before` pages back
  // by id and `after` tails the lines newer than an id.
  api.get("/logs", (req, res) => {
    const level = (LEVELS as readonly string[]).includes(String(req.query.level)) ? (req.query.level as Level) : "info";
    res.json(
      store.logs({
        levels: LEVELS.slice(LEVELS.indexOf(level)),
        query: typeof req.query.q === "string" ? req.query.q : "",
        before: count(req.query.before, Number.MAX_SAFE_INTEGER),
        after: count(req.query.after, 0),
        limit: Math.min(count(req.query.limit, 500), 5000),
      }),
    );
  });

  api.get("/settings", (_req, res) => {
    res.json(publicSettings(config.settings()));
  });

  // Takes the settings to change. Secrets left empty keep their saved value.
  api.patch("/settings", (req, res) => {
    const old = config.settings();
    const next = parseSettings(req.body, old);
    config.saveSettings(next);
    if (next.logRetentionDays < old.logRetentionDays) store.pruneLogs(next.logRetentionDays);
    const testMode = old.testMode === next.testMode ? "" : next.testMode ? ", test mode on" : ", test mode off";
    changed("settings", `Settings saved${testMode}`, settingsChanges(old, next));
    res.json(publicSettings(next));
  });

  // Tests the settings sent, filled in from the saved ones, before saving them.
  // With no body, it tests what is saved.
  api.post("/test/qbittorrent", async (req, res) => {
    const { qbittorrent } = parseSettings({ qbittorrent: req.body ?? {} }, config.settings());
    const result = await test(() => createQbit(qbittorrent).version());
    tested("qBittorrent", qbittorrent.address, result);
    res.json(result);
  });

  api.post("/test/prowlarr", async (req, res) => {
    const { prowlarr } = parseSettings({ prowlarr: req.body ?? {} }, config.settings());
    const result = await test(() => createProwlarr(prowlarr).version());
    tested("Prowlarr", prowlarr.address, result);
    res.json(result);
  });

  // Prowlarr's indexers and sync profiles, for the rule editor.
  api.get("/prowlarr", async (_req, res) => {
    const prowlarr = createProwlarr(config.settings().prowlarr);
    const [indexers, profiles] = await Promise.all([prowlarr.indexers(), prowlarr.profiles()]);
    log.info("api", "Loaded Prowlarr's indexers and sync profiles", { indexers: indexers.length, profiles: profiles.length });
    res.json({ indexers, profiles });
  });

  api.use((req, res) => {
    log.warn("api", "Not found", { request: `${req.method} ${req.originalUrl}` });
    res.status(404).json({ error: "Not found" });
  });

  // A request that fails is logged with what it asked for.
  const errors: ErrorRequestHandler = (error, req, res, _next) => {
    const request = `${req.method} ${req.originalUrl}`;
    if (error instanceof ValidationError) {
      log.warn("api", `Rejected: ${error.message}`, { request });
      res.status(400).json({ error: error.message });
    } else if (error instanceof ConnectionError) {
      log.warn("api", error.message, { request });
      res.status(502).json({ error: error.message, reason: error.reason });
    } else if (error?.type === "entity.parse.failed") {
      log.warn("api", "Rejected: the body isn't valid JSON", { request });
      res.status(400).json({ error: "The body isn't valid JSON" });
    } else {
      log.error("api", "Request failed", { request, error: (error as Error).message });
      res.status(500).json({ error: "Something went wrong" });
    }
  };

  app.use("/api", api, errors);
  app.use(express.static(APP_DIST));
  return app;
}

// What a rule is set to, as log fields.
function ruleFields(rule: Rule): Fields {
  const { prowlarr } = rule;
  return {
    name: rule.name,
    tags: rule.tags.join(", "),
    domains: rule.domains.join(", "),
    holdBelow: rule.holdBelow,
    releaseAbove: rule.releaseAbove,
    action: rule.action,
    prowlarr: prowlarr
      ? `indexer ${prowlarr.indexerId}, profile ${prowlarr.heldProfileId} while held, ${prowlarr.restoreProfileId} after`
      : "off",
    enabled: rule.enabled,
  };
}

// What a settings save changed. Secrets only say that they did, and the log
// redacts even that, by their names.
function settingsChanges(old: Settings, next: Settings): Fields {
  const plain = (s: Settings): Fields => ({
    "qbittorrent.address": s.qbittorrent.address,
    "prowlarr.address": s.prowlarr.address,
    pollSeconds: s.pollSeconds,
    testMode: s.testMode,
    logRetentionDays: s.logRetentionDays,
  });
  const fields = changes(plain(old), plain(next));
  if (old.qbittorrent.apiKey !== next.qbittorrent.apiKey) fields["qbittorrent.apiKey"] = "changed";
  if (old.prowlarr.apiKey !== next.prowlarr.apiKey) fields["prowlarr.apiKey"] = "changed";
  return fields;
}

// The fields that differ, as "old → new".
function changes(old: Fields, next: Fields): Fields {
  const show = (value: Fields[string]) => (value === "" || value === null ? "none" : String(value));
  const fields: Fields = {};
  for (const key of Object.keys(next)) {
    if (old[key] !== next[key]) fields[key] = `${show(old[key])} → ${show(next[key])}`;
  }
  return fields;
}

// Bytes as GiB, to two decimals at most: "30 GiB", "1.5 GiB".
function formatGiB(bytes: number): string {
  return `${Number((bytes / GIB).toFixed(2))} GiB`;
}

// A positive whole number from the query string, or the fallback.
function count(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}
