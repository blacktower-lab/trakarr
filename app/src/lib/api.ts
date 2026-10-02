// The wire types of trakarr's REST API, and one function per route. Each type
// names the server source it mirrors, which can't be imported here because it
// pulls in node:* modules.

// server/src/config.ts
export type HoldAction = "throttle" | "stop";

export interface ProwlarrSwitch {
  indexerId: number;
  heldProfileId: number;
  restoreProfileId: number;
}

export interface RuleConfig {
  id: string;
  name: string;
  domains: string[];
  holdBelow: number;
  releaseAbove: number;
  // Holds on the buffer instead of the two ratios above, which then don't count.
  byBuffer: boolean;
  action: HoldAction;
  prowlarr: ProwlarrSwitch | null;
  enabled: boolean;
}

// What a rule's form sets. A new rule starts enabled.
export type RuleFields = Omit<RuleConfig, "id" | "enabled">;

export interface Match {
  domains: string[];
}

// What a tracker's site counts that qBittorrent doesn't.
export interface Freeleech {
  from: number;
  until: number;
}

export interface TrackerQuota {
  domain: string;
  // Bytes of upload bought with bonus points.
  bought: number;
  freeleech: Freeleech | null;
  pinned: boolean;
}

// What PATCH /trackers/:domain takes: bytes of bought upload to add, negative
// to take back a mistake, a freeleech to start for so many hours, or null to
// end it, and whether the tracker is pinned to the top of the dashboard.
export interface QuotaChange {
  addBought?: number;
  freeleechHours?: number | null;
  pinned?: boolean;
}

// server/src/config.ts
export type Clock = "12" | "24";
export type Language = "en" | "es";

// publicSettings(): secrets only say whether they're set.
export interface SavedSettings {
  qbittorrent: { address: string; hasApiKey: boolean };
  prowlarr: { address: string; hasApiKey: boolean };
  ntfy: { address: string; topic: string; hasToken: boolean };
  // Empty for the browser's time zone.
  timeZone: string;
  clock: Clock;
  language: Language;
  pollSeconds: number;
  testMode: boolean;
  logRetentionDays: number;
}

// What PATCH /settings takes. An empty secret keeps the saved one.
export interface SettingsInput {
  qbittorrent?: { address?: string; apiKey?: string };
  prowlarr?: { address?: string; apiKey?: string };
  ntfy?: { address?: string; topic?: string; token?: string };
  timeZone?: string;
  clock?: Clock;
  language?: Language;
  pollSeconds?: number;
  testMode?: boolean;
  logRetentionDays?: number;
}

// server/src/connection.ts. Only a service with a version has one to say.
export type TestResult =
  | { ok: true; version?: string }
  | { ok: false; reason: "credentials" | "unreachable"; message: string };

// server/src/store.ts
export type EventKind = "hold" | "release" | "rule" | "tracker" | "settings" | "error";

export interface TrakarrEvent {
  id: number;
  at: number;
  kind: EventKind;
  text: string;
  testMode: boolean;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogLine {
  id: number;
  at: number;
  level: LogLevel;
  scope: string;
  message: string;
  fields: Record<string, string | number | boolean | null> | null;
}

// server/src/watcher.ts, status() and preview()
export type RuleState = "ok" | "held";

export interface Preview {
  torrents: number;
  uploaded: number;
  downloaded: number;
}

export interface RuleStatus extends Preview {
  id: string;
  state: RuleState;
}

// A domain the torrents in qBittorrent announce to. Its uploaded includes
// what was bought, and its downloaded leaves out what came on a freeleech.
export interface TrackerStatus extends Preview {
  domain: string;
  // The first rule whose domains take it in.
  ruleId: string | null;
  bought: number;
  freeleech: Freeleech | null;
  pinned: boolean;
}

export interface HeldTorrent {
  hash: string;
  // Empty for a torrent no rule holds, which trakarr took over.
  ruleId: string;
  name: string;
  // Null once the torrent is gone from qBittorrent.
  progress: number | null;
  at: number;
}

export interface Status {
  qbittorrent: TestResult & { address: string; lastUpdate: number | null };
  pollSeconds: number;
  testMode: boolean;
  rules: RuleStatus[];
  trackers: TrackerStatus[];
  held: HeldTorrent[];
}

// server/src/prowlarr.ts
export interface Indexer {
  id: number;
  name: string;
  appProfileId: number;
}

export interface SyncProfile {
  id: number;
  name: string;
}

export interface ProwlarrOptions {
  indexers: Indexer[];
  profiles: SyncProfile[];
}

// server/src/api.ts, GET /session: whether the dashboard asks for a password,
// and whether this browser has signed in.
export interface Session {
  required: boolean;
  authenticated: boolean;
}

const UNREACHABLE = "Can't reach trakarr";

// Told when a request is turned away for having no session, say because it
// expired, so the app goes back to the sign-in.
let onUnauthorized: () => void = () => {};

// Paths are relative because the UI is built with a relative base, so it works
// from any path. Fails with the server's own message when it sends one.
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`api/${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(UNREACHABLE);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: something in front of trakarr answered, like a proxy with nothing behind it.
  }
  if (res.status === 401 && path !== "login") onUnauthorized();
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? UNREACHABLE);
  return data as T;
}

export const api = {
  onUnauthorized: (handler: () => void) => {
    onUnauthorized = handler;
  },
  session: () => request<Session>("GET", "session"),
  login: (password: string) => request<null>("POST", "login", { password }),
  logout: () => request<null>("POST", "logout"),
  // The current password is only needed when there is one. An empty new one removes it.
  setPassword: (change: { current?: string; next: string }) => request<null>("POST", "password", change),
  status: () => request<Status>("GET", "status"),
  rules: () => request<RuleConfig[]>("GET", "rules"),
  createRule: (rule: RuleFields) => request<RuleConfig>("POST", "rules", rule),
  // Takes only the fields to change.
  updateRule: (id: string, patch: Partial<RuleFields> & { enabled?: boolean }) =>
    request<RuleConfig>("PATCH", `rules/${encodeURIComponent(id)}`, patch),
  deleteRule: (id: string) => request<null>("DELETE", `rules/${encodeURIComponent(id)}`),
  preview: (match: Match) => request<Preview>("POST", "rules/preview", match),
  updateTracker: (domain: string, change: QuotaChange) =>
    request<TrackerQuota>("PATCH", `trackers/${encodeURIComponent(domain)}`, change),
  events: (limit: number) => request<TrakarrEvent[]>("GET", `events?limit=${limit}`),
  // Lines at `level` or above, oldest first. `after` tails what is newer than an id.
  logs: ({ level, limit, after }: { level: LogLevel; limit: number; after?: number }) => {
    const query = new URLSearchParams({ level, limit: String(limit) });
    if (after) query.set("after", String(after));
    return request<LogLine[]>("GET", `logs?${query}`);
  },
  settings: () => request<SavedSettings>("GET", "settings"),
  saveSettings: (patch: SettingsInput) => request<SavedSettings>("PATCH", "settings", patch),
  // With no draft, tests the saved settings.
  testQbittorrent: (draft?: NonNullable<SettingsInput["qbittorrent"]>) =>
    request<TestResult>("POST", "test/qbittorrent", draft),
  testProwlarr: (draft?: NonNullable<SettingsInput["prowlarr"]>) =>
    request<TestResult>("POST", "test/prowlarr", draft),
  // Sends a real notification.
  testNtfy: (draft?: NonNullable<SettingsInput["ntfy"]>) => request<TestResult>("POST", "test/ntfy", draft),
  prowlarr: () => request<ProwlarrOptions>("GET", "prowlarr"),
};
