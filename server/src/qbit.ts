import { createHash } from "node:crypto";
import type { Settings } from "./config.ts";
import { baseUrl, ConnectionError, send } from "./connection.ts";
import type { Torrent } from "./engine.ts";

// The few qBittorrent Web API calls trakarr makes (Web API 2.x). It authenticates with
// an API key, which qBittorrent has from 5.2 on.

export function createQbit({ address, apiKey }: Settings["qbittorrent"]) {
  const base = `${baseUrl(address)}/api/v2/`;
  // The session cookie's name is a qBittorrent setting, so every cookie is kept.
  // Without auth, qBittorrent still ties the sync state to it.
  const cookies = new Map<string, string>();

  function keepCookies(res: Response) {
    for (const cookie of res.headers.getSetCookie()) {
      const [pair = ""] = cookie.split(";");
      const at = pair.indexOf("=");
      if (at > 0) cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
  }

  function request(path: string, form?: Record<string, string>): Promise<Response> {
    const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    const headers: Record<string, string> = {};
    if (cookie) headers.cookie = cookie;
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    return send("qBittorrent", address, base + path, {
      method: form ? "POST" : "GET",
      headers,
      body: form && new URLSearchParams(form),
    });
  }

  // Without a key, or with a wrong one, qBittorrent refuses with a 401 or a 403.
  async function call(path: string, form?: Record<string, string>): Promise<string> {
    const res = await request(path, form);
    keepCookies(res);
    if (res.status === 401 || res.status === 403) {
      throw new ConnectionError(
        "credentials",
        apiKey ? `qBittorrent rejected the API key (${res.status})` : "qBittorrent asks for an API key and none is set",
      );
    }
    if (!res.ok) throw new ConnectionError("unreachable", `qBittorrent returned ${res.status} for ${path}`);
    return res.text();
  }

  const hashes = (list: string[]) => list.join("|");

  return {
    version: async () => (await call("app/version")).trim().replace(/^v/, ""),
    maindata: async (rid: number) => JSON.parse(await call(`sync/maindata?rid=${rid}`)) as Maindata,
    // 0 and -1 both mean no limit.
    setDownloadLimit: (list: string[], limit: number) =>
      call("torrents/setDownloadLimit", { hashes: hashes(list), limit: String(limit) }),
    stop: (list: string[]) => call("torrents/stop", { hashes: hashes(list) }),
    start: (list: string[]) => call("torrents/start", { hashes: hashes(list) }),
    addTag: (list: string[], tag: string) => call("torrents/addTags", { hashes: hashes(list), tags: tag }),
    // Always called with a tag: without one, qBittorrent removes every tag.
    removeTag: (list: string[], tag: string) => call("torrents/removeTags", { hashes: hashes(list), tags: tag }),
  };
}

export type Qbit = ReturnType<typeof createQbit>;

// The parts of a sync/maindata response trakarr reads. After the first full
// snapshot, a torrent only carries the fields that changed.
export interface Maindata {
  rid: number;
  full_update?: boolean;
  torrents?: Record<string, Partial<RawTorrent>>;
  torrents_removed?: string[];
  // Tracker URL to the hashes of the torrents that announce to it.
  trackers?: Record<string, string[]>;
  trackers_removed?: string[];
}

interface RawTorrent {
  name: string;
  tags: string;
  uploaded: number;
  downloaded: number;
  dl_limit: number;
  state: string;
  progress: number;
}

// Only these fields are kept: others, like magnet_uri and tracker, can carry a passkey.
const KEPT = ["name", "tags", "uploaded", "downloaded", "dl_limit", "state", "progress"] as const;

// qBittorrent's view, rebuilt from sync/maindata. Trackers are keyed by a hash
// of their URL, so the URL itself isn't kept.
export interface Snapshot {
  rid: number;
  torrents: Map<string, Partial<RawTorrent>>;
  trackers: Map<string, { domain: string; hashes: string[] }>;
}

export function emptySnapshot(): Snapshot {
  return { rid: 0, torrents: new Map(), trackers: new Map() };
}

export function applyMaindata(snapshot: Snapshot, data: Maindata) {
  // A full update replaces everything, as after qBittorrent restarts.
  if (data.full_update) {
    snapshot.torrents.clear();
    snapshot.trackers.clear();
  }
  snapshot.rid = data.rid;
  for (const [hash, diff] of Object.entries(data.torrents ?? {})) {
    const torrent = snapshot.torrents.get(hash) ?? {};
    for (const key of KEPT) if (diff[key] !== undefined) Object.assign(torrent, { [key]: diff[key] });
    snapshot.torrents.set(hash, torrent);
  }
  for (const hash of data.torrents_removed ?? []) snapshot.torrents.delete(hash);
  for (const [url, hashes] of Object.entries(data.trackers ?? {})) {
    const domain = domainOf(url);
    if (domain) snapshot.trackers.set(keyOf(url), { domain, hashes });
  }
  for (const url of data.trackers_removed ?? []) snapshot.trackers.delete(keyOf(url));
}

export function torrentsOf(snapshot: Snapshot): Map<string, Torrent> {
  const domains = new Map<string, Set<string>>();
  for (const { domain, hashes } of snapshot.trackers.values()) {
    for (const hash of hashes) domains.set(hash, (domains.get(hash) ?? new Set()).add(domain));
  }
  const torrents = new Map<string, Torrent>();
  for (const [hash, raw] of snapshot.torrents) {
    torrents.set(hash, {
      hash,
      name: raw.name ?? "",
      tags: (raw.tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
      domains: [...(domains.get(hash) ?? [])],
      uploaded: raw.uploaded ?? 0,
      downloaded: raw.downloaded ?? 0,
      dlLimit: raw.dl_limit ?? -1,
      state: raw.state ?? "",
      progress: raw.progress ?? 0,
    });
  }
  return torrents;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function keyOf(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}
