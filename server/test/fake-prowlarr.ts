import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for Prowlarr's API: the indexers' sync profiles and the calls
// that change them.

export interface FakeProwlarr {
  address: string;
  apiKey: string;
  profiles: Map<number, number>;
  // Profile changes asked for, as "indexer profile".
  calls: string[];
  down: boolean;
  close: () => Promise<void>;
}

export async function startFakeProwlarr(): Promise<FakeProwlarr> {
  const fake = { apiKey: "key", profiles: new Map<number, number>(), calls: [] as string[], down: false };

  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const send = (status: number, value: unknown) => res.writeHead(status).end(JSON.stringify(value));

    if (fake.down) return send(503, {});
    if (req.headers["x-api-key"] !== fake.apiKey) return send(401, {});
    if (req.url === "/api/v1/system/status") return send(200, { version: "2.3.0" });
    if (req.url === "/api/v1/indexer/bulk" && req.method === "PUT") {
      const { ids, appProfileId } = JSON.parse(body) as { ids: number[]; appProfileId: number };
      for (const id of ids) {
        fake.profiles.set(id, appProfileId);
        fake.calls.push(`${id} ${appProfileId}`);
      }
      return send(202, []);
    }
    send(404, {});
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return Object.assign(fake, {
    address: `127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}
