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
  tags: string[];
  domains: string[];
  holdBelow: number;
  releaseAbove: number;
  action: HoldAction;
  prowlarr: ProwlarrSwitch | null;
  enabled: boolean;
}

// What a rule's form sets. A new rule starts enabled.
export type RuleFields = Omit<RuleConfig, "id" | "enabled">;

export interface Match {
  tags: string[];
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
}

// What PATCH /trackers/:domain takes: bytes of bought upload to add, negative
// to take back a mistake, and a freeleech to start for so many hours, or null
// to end it.
export interface QuotaChange {
  addBought?: number;
  freeleechHours?: number | null;
}

// publicSettings(): secrets only say whether they're set.
export interface SavedSettings {
  qbittorrent: { address: string; username: string; hasPassword: boolean };
  prowlarr: { address: string; hasApiKey: boolean };
  pollSeconds: number;
  testMode: boolean;
  logRetentionDays: number;
}

// What PATCH /settings takes. An empty secret keeps the saved one.
export interface SettingsInput {
  qbittorrent?: { address?: string; username?: string; password?: string };
  prowlarr?: { address?: string; apiKey?: string };
  pollSeconds?: number;
  testMode?: boolean;
  logRetentionDays?: number;
}

// server/src/connection.ts
export type TestResult =
  | { ok: true; version: string }
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

const UNREACHABLE = "Can't reach trakarr";

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
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? UNREACHABLE);
  return data as T;
}

export const api = {
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
  prowlarr: () => request<ProwlarrOptions>("GET", "prowlarr"),
};
