import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for qBittorrent with the endpoints trakarr uses. It answers every
// sync/maindata with a full update and records every change it's asked for.

export interface FakeTorrent {
  name: string;
  tags: string;
  uploaded: number;
  downloaded: number;
  dl_limit: number;
  state: string;
  progress: number;
  trackers: string[];
}

export interface FakeQbit {
  address: string;
  torrents: Map<string, FakeTorrent>;
  // Changes asked for, as "endpoint hashes [value]".
  calls: string[];
  // Set to make the fake refuse requests that don't carry this API key.
  apiKey: string | null;
  down: boolean;
  close: () => Promise<void>;
}

export async function startFakeQbit(): Promise<FakeQbit> {
  const fake: Omit<FakeQbit, "address" | "close"> = { torrents: new Map(), calls: [], apiKey: null, down: false };
  let rid = 0;

  const server: Server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    const url = new URL(req.url ?? "/", "http://fake");
    const path = url.pathname.replace("/api/v2/", "");
    const send = (status: number, text: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, headers).end(text);
    };

    if (fake.down) return send(503, "");
    if (fake.apiKey && req.headers.authorization !== `Bearer ${fake.apiKey}`) return send(403, "Forbidden");

    if (path === "app/version") return send(200, "v5.2.3");
    if (path === "sync/maindata") {
      const torrents: Record<string, Omit<FakeTorrent, "trackers">> = {};
      const trackers: Record<string, string[]> = {};
      for (const [hash, { trackers: urls, ...t }] of fake.torrents) {
        torrents[hash] = { ...t, magnet_uri: `magnet:?xt=urn:btih:${hash}&tr=${urls[0]}` } as typeof t;
        for (const tracker of urls) trackers[tracker] = [...(trackers[tracker] ?? []), hash];
      }
      return send(200, JSON.stringify({ rid: ++rid, full_update: true, torrents, trackers }));
    }

    const hashes = (form.get("hashes") ?? "").split("|");
    const each = (change: (t: FakeTorrent) => void) => {
      for (const hash of hashes) {
        const t = fake.torrents.get(hash);
        if (t) change(t);
      }
    };
    switch (path) {
      case "torrents/setDownloadLimit": {
        const limit = Number(form.get("limit"));
        each((t) => (t.dl_limit = limit <= 0 ? -1 : limit));
        fake.calls.push(`setDownloadLimit ${hashes.join("|")} ${limit}`);
        return send(200, "");
      }
      case "torrents/stop":
        each((t) => (t.state = "stoppedDL"));
        fake.calls.push(`stop ${hashes.join("|")}`);
        return send(200, "");
      case "torrents/start":
        each((t) => (t.state = "downloading"));
        fake.calls.push(`start ${hashes.join("|")}`);
        return send(200, "");
      case "torrents/addTags":
        each((t) => (t.tags = [...splitTags(t.tags), form.get("tags")].join(", ")));
        fake.calls.push(`addTags ${hashes.join("|")} ${form.get("tags")}`);
        return send(200, "");
      case "torrents/removeTags":
        each((t) => (t.tags = splitTags(t.tags).filter((tag) => tag !== form.get("tags")).join(", ")));
        fake.calls.push(`removeTags ${hashes.join("|")} ${form.get("tags")}`);
        return send(200, "");
    }
    send(404, "Not found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return Object.assign(fake, {
    address: `127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}

function splitTags(tags: string): string[] {
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}
