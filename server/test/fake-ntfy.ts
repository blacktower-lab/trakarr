import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for an ntfy server: it takes messages published as JSON to its
// root and keeps them.

export interface FakeNtfyMessage {
  topic: string;
  title: string;
  message: string;
  priority?: number;
}

export interface FakeNtfy {
  address: string;
  // Set to make the fake refuse messages that don't carry this access token.
  token: string | null;
  messages: FakeNtfyMessage[];
  down: boolean;
  close: () => Promise<void>;
}

export async function startFakeNtfy(): Promise<FakeNtfy> {
  const fake = { token: null as string | null, messages: [] as FakeNtfyMessage[], down: false };

  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const send = (status: number, value: unknown) => res.writeHead(status).end(JSON.stringify(value));

    if (fake.down) return send(503, {});
    if (fake.token && req.headers.authorization !== `Bearer ${fake.token}`) return send(403, { error: "forbidden" });
    if (req.method === "POST" && req.url === "/") {
      fake.messages.push(JSON.parse(body) as FakeNtfyMessage);
      return send(200, { id: "x" });
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
