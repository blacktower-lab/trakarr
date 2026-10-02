import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Like Seerr, everything trakarr keeps lives in one directory: settings.json,
// rules.json and trackers.json, which the user edits, and trakarr.db and
// auth.json, which trakarr writes. auth.json has the hash of the dashboard's
// password, and deleting it opens the dashboard again.
export const CONFIG_DIR = resolve(process.env.CONFIG_DIRECTORY ?? join(import.meta.dirname, "../../config"));

export type HoldAction = "throttle" | "stop";

export interface ProwlarrSwitch {
  indexerId: number;
  heldProfileId: number;
  restoreProfileId: number;
}

export interface Rule {
  id: string;
  name: string;
  tags: string[];
  domains: string[];
  holdBelow: number;
  releaseAbove: number;
  action: HoldAction;
  prowlarr: ProwlarrSwitch | null;
  enabled: boolean;
}

// What a tracker's site counts that qBittorrent doesn't: upload bought with
// bonus points, and a freeleech, while downloads don't count. It also keeps
// whether the dashboard pins the tracker to the top of its list.
export interface TrackerQuota {
  domain: string;
  // Bytes of upload bought, on top of what its torrents uploaded.
  bought: number;
  freeleech: Freeleech | null;
  pinned: boolean;
}

export interface Freeleech {
  from: number;
  until: number;
}

// What PATCH /trackers/:domain changes. Bought upload can go down, to take
// back a mistake. A freeleech starts now for so many hours, or null ends it.
// Pinning is set, not toggled.
export interface QuotaChange {
  domain: string;
  addBought: number;
  freeleechHours: number | null | undefined;
  pinned: boolean | undefined;
}

// A freeleech is at most a month long.
const MAX_FREELEECH_HOURS = 24 * 30;

export interface Settings {
  qbittorrent: { address: string; apiKey: string };
  prowlarr: { address: string; apiKey: string };
  // Where trakarr sends its notifications. The token is only for a server that
  // asks for one.
  ntfy: { address: string; topic: string; token: string };
  pollSeconds: number;
  testMode: boolean;
  // Days a log line is kept. Events stay.
  logRetentionDays: number;
}

const DEFAULT_SETTINGS: Settings = {
  qbittorrent: { address: "", apiKey: "" },
  prowlarr: { address: "", apiKey: "" },
  ntfy: { address: "", topic: "", token: "" },
  pollSeconds: 5,
  // A fresh install only logs what it would do.
  testMode: true,
  logRetentionDays: 14,
};

// What guards the dashboard: the hash of its password, or none for an open one.
export interface Auth {
  password: string;
}

export const MIN_PASSWORD = 8;

export class ValidationError extends Error {}

export function openConfig(dir = CONFIG_DIR) {
  mkdirSync(dir, { recursive: true });
  const settingsPath = join(dir, "settings.json");
  const rulesPath = join(dir, "rules.json");
  const trackersPath = join(dir, "trackers.json");
  const authPath = join(dir, "auth.json");

  // Both files can be edited by hand, so they go through the same checks as
  // the API, and missing keys take their defaults.
  let settings = checked(settingsPath, () => parseSettings(readJson(settingsPath, {}), DEFAULT_SETTINGS));
  let rules = checked(rulesPath, () =>
    readJson<unknown[]>(rulesPath, []).map((rule) => parseRule(rule, (rule as { id?: unknown }).id)),
  );
  let trackers = checked(trackersPath, () => readJson<unknown[]>(trackersPath, []).map(parseTracker));
  let auth = checked(authPath, () => ({ password: text(object(readJson(authPath, {}), "auth").password ?? "", "password") }));
  writeJson(settingsPath, settings);

  return {
    settings: () => settings,
    rules: () => rules,
    trackers: () => trackers,
    auth: () => auth,
    saveAuth(next: Auth) {
      writeJson(authPath, next);
      auth = next;
    },
    saveSettings(next: Settings) {
      writeJson(settingsPath, next);
      settings = next;
    },
    saveRules(next: Rule[]) {
      writeJson(rulesPath, next);
      rules = next;
    },
    // A tracker with nothing bought, no freeleech and no pin has nothing to keep.
    saveTrackers(next: TrackerQuota[]) {
      const kept = next.filter((tracker) => tracker.bought > 0 || tracker.freeleech !== null || tracker.pinned);
      writeJson(trackersPath, kept);
      trackers = kept;
    },
  };
}

export type Config = ReturnType<typeof openConfig>;

// What the API shows of the settings: secrets only say whether they're set.
export function publicSettings({ qbittorrent, prowlarr, ntfy, pollSeconds, testMode, logRetentionDays }: Settings) {
  return {
    qbittorrent: { address: qbittorrent.address, hasApiKey: qbittorrent.apiKey !== "" },
    prowlarr: { address: prowlarr.address, hasApiKey: prowlarr.apiKey !== "" },
    ntfy: { address: ntfy.address, topic: ntfy.topic, hasToken: ntfy.token !== "" },
    pollSeconds,
    testMode,
    logRetentionDays,
  };
}

// Fills what the input leaves out from the current settings. An empty secret
// keeps the saved one, since the UI never receives it to send it back.
export function parseSettings(input: unknown, current: Settings): Settings {
  const s = object(input, "settings");
  const qbit = object(s.qbittorrent ?? {}, "qbittorrent");
  const prowlarr = object(s.prowlarr ?? {}, "prowlarr");
  const ntfy = object(s.ntfy ?? {}, "ntfy");
  const pollSeconds = s.pollSeconds === undefined ? current.pollSeconds : whole(s.pollSeconds, "pollSeconds", 1, 300);
  const logRetentionDays =
    s.logRetentionDays === undefined ? current.logRetentionDays : whole(s.logRetentionDays, "logRetentionDays", 1, 365);
  return {
    qbittorrent: {
      address: optionalText(qbit.address, "qbittorrent.address", current.qbittorrent.address),
      apiKey: optionalText(qbit.apiKey, "qbittorrent.apiKey", "") || current.qbittorrent.apiKey,
    },
    prowlarr: {
      address: optionalText(prowlarr.address, "prowlarr.address", current.prowlarr.address),
      apiKey: optionalText(prowlarr.apiKey, "prowlarr.apiKey", "") || current.prowlarr.apiKey,
    },
    ntfy: {
      address: optionalText(ntfy.address, "ntfy.address", current.ntfy.address),
      topic: topic(optionalText(ntfy.topic, "ntfy.topic", current.ntfy.topic)),
      token: optionalText(ntfy.token, "ntfy.token", "") || current.ntfy.token,
    },
    pollSeconds,
    testMode: s.testMode === undefined ? current.testMode : boolean(s.testMode, "testMode"),
    logRetentionDays,
  };
}

export function parseRule(input: unknown, id: unknown): Rule {
  const r = object(input, "rule");
  if (typeof id !== "string" || id === "") throw new ValidationError("A rule needs an id");
  const name = text(r.name, "name").trim();
  if (name === "") throw new ValidationError("name is required");
  const { tags, domains } = parseMatch(r);
  if (tags.length === 0 && domains.length === 0) throw new ValidationError("Add a tag or a domain");
  const holdBelow = number(r.holdBelow, "holdBelow");
  const releaseAbove = number(r.releaseAbove, "releaseAbove");
  if (!(holdBelow > 0)) throw new ValidationError("holdBelow must be greater than 0");
  if (!(releaseAbove > holdBelow)) throw new ValidationError("releaseAbove must be greater than holdBelow");
  const action = r.action ?? "throttle";
  if (action !== "throttle" && action !== "stop") throw new ValidationError("action must be throttle or stop");
  return {
    id,
    name,
    tags,
    domains,
    holdBelow,
    releaseAbove,
    action,
    prowlarr: r.prowlarr == null ? null : parseProwlarr(r.prowlarr),
    enabled: r.enabled === undefined ? true : boolean(r.enabled, "enabled"),
  };
}

// A rule's tags and domains, trimmed and without repeats. A pasted announce
// URL keeps only its host, so its passkey is never stored.
export function parseMatch(input: unknown): { tags: string[]; domains: string[] } {
  const r = object(input, "match");
  const tags = unique(list(r.tags ?? [], "tags").map((tag) => tag.trim()));
  const domains = unique(list(r.domains ?? [], "domains").map(toDomain));
  const bad = domains.find((domain) => !DOMAIN.test(domain));
  if (bad !== undefined) throw new ValidationError(bad.includes("/") ? "A domain isn't valid" : `${bad} isn't a domain`);
  return { tags, domains };
}

export function parseLogin(input: unknown): string {
  return text(object(input ?? {}, "login").password, "password");
}

// A new password, or an empty one to remove it. The current one is only needed
// when there is one.
export function parsePasswordChange(input: unknown): { current: string; next: string } {
  const c = object(input ?? {}, "password");
  const next = text(c.next, "next");
  if (next !== "" && next.length < MIN_PASSWORD) {
    throw new ValidationError(`The password needs at least ${MIN_PASSWORD} characters`);
  }
  return { current: c.current === undefined ? "" : text(c.current, "current"), next };
}

function parseTracker(input: unknown): TrackerQuota {
  const t = object(input, "tracker");
  return {
    domain: domainOf(t.domain),
    bought: atLeastZero(t.bought ?? 0, "bought"),
    freeleech: t.freeleech == null ? null : parseFreeleech(t.freeleech),
    pinned: t.pinned === undefined ? false : boolean(t.pinned, "pinned"),
  };
}

function parseFreeleech(input: unknown): Freeleech {
  const f = object(input, "freeleech");
  const from = atLeastZero(f.from, "freeleech.from");
  const until = atLeastZero(f.until, "freeleech.until");
  if (!(until > from)) throw new ValidationError("freeleech.until must be after freeleech.from");
  return { from, until };
}

export function parseQuotaChange(domain: unknown, input: unknown): QuotaChange {
  const c = object(input ?? {}, "change");
  const addBought = c.addBought === undefined ? 0 : number(c.addBought, "addBought");
  if (!Number.isInteger(addBought)) throw new ValidationError("addBought must be whole bytes");
  return {
    domain: domainOf(domain),
    addBought,
    freeleechHours:
      c.freeleechHours === undefined || c.freeleechHours === null
        ? c.freeleechHours
        : whole(c.freeleechHours, "freeleechHours", 1, MAX_FREELEECH_HOURS),
    pinned: c.pinned === undefined ? undefined : boolean(c.pinned, "pinned"),
  };
}

function domainOf(value: unknown): string {
  const domain = toDomain(text(value, "domain"));
  if (!DOMAIN.test(domain)) throw new ValidationError(`${domain} isn't a domain`);
  return domain;
}

function parseProwlarr(input: unknown): ProwlarrSwitch {
  const p = object(input, "prowlarr");
  return {
    indexerId: id(p.indexerId, "prowlarr.indexerId"),
    heldProfileId: id(p.heldProfileId, "prowlarr.heldProfileId"),
    restoreProfileId: id(p.restoreProfileId, "prowlarr.restoreProfileId"),
  };
}

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function toDomain(value: string): string {
  const v = value.trim().toLowerCase();
  if (!v.includes("/")) return v;
  try {
    return new URL(v.includes("://") ? v : `http://${v}`).hostname;
  } catch {
    return v;
  }
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ValidationError(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string") throw new ValidationError(`${name} must be text`);
  return value;
}

function optionalText(value: unknown, name: string, fallback: string): string {
  return value === undefined ? fallback : text(value, name).trim();
}

// ntfy's own limits on a topic's name.
function topic(value: string): string {
  if (value !== "" && !/^[-_A-Za-z0-9]{1,64}$/.test(value)) {
    throw new ValidationError("A topic is up to 64 letters, numbers, - and _");
  }
  return value;
}

function number(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ValidationError(`${name} must be a number`);
  return value;
}

function whole(value: unknown, name: string, min: number, max: number): number {
  const n = number(value, name);
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${name} must be a whole number from ${min} to ${max}`);
  return n;
}

// Bytes or a time, as a whole number.
function atLeastZero(value: unknown, name: string): number {
  const n = number(value, name);
  if (!Number.isInteger(n) || n < 0) throw new ValidationError(`${name} must be a whole number, 0 or more`);
  return n;
}

function id(value: unknown, name: string): number {
  const n = number(value, name);
  if (!Number.isInteger(n) || n < 1) throw new ValidationError(`${name} must be an id`);
  return n;
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new ValidationError(`${name} must be true or false`);
  return value;
}

function list(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new ValidationError(`${name} must be a list`);
  return value.map((item) => text(item, name));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value !== ""))];
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}

// A broken file stops trakarr with the file's name, rather than being overwritten.
function checked<T>(path: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new Error(`Can't read ${path}: ${(error as Error).message}`);
  }
}

// Written like Seerr and Bazarr do: to a temporary file first, then renamed
// over the old one, so a crash never leaves half a file. Only the owner can
// read it, since settings.json holds secrets.
function writeJson(path: string, value: unknown) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}
