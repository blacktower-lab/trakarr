import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, test } from "node:test";
import { createApi } from "../src/api.ts";
import { openConfig } from "../src/config.ts";
import { createLog } from "../src/log.ts";
import { openStore } from "../src/store.ts";
import { createWatcher } from "../src/watcher.ts";

const TMP = mkdtempSync(join(import.meta.dirname, ".tmp-"));
const servers: Server[] = [];
after(() => {
  for (const server of servers) server.close();
  rmSync(TMP, { recursive: true, force: true });
});

// A server of its own per test, since a lockout is kept in memory by address.
// `restart` starts another over the same files, as a restart of trakarr would.
function start() {
  const dir = mkdtempSync(join(TMP, "case-"));
  const open = async () => {
    const config = openConfig(dir);
    const store = openStore(join(dir, "trakarr.db"));
    const log = createLog(store, "debug", false);
    const server = createApi({ config, store, log, watcher: createWatcher({ config, store, log, notify: () => {} }) }).listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    servers.push(server);
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  };

  async function call(base: string, method: string, path: string, body?: unknown, cookie = "") {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(cookie && { cookie }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return {
      status: res.status,
      body: text ? JSON.parse(text) : null,
      // The cookie to send back, from what the server set.
      cookie: res.headers.getSetCookie()[0]?.split(";")[0] ?? "",
      setCookie: res.headers.getSetCookie()[0] ?? "",
    };
  }

  return { dir, open, call, logs: async (base: string, cookie: string) => (await call(base, "GET", "/logs?level=debug&limit=500", undefined, cookie)).body as { message: string; fields: unknown }[] };
}

test("the dashboard is open until a password is set", async () => {
  const { open, call } = start();
  const base = await open();

  assert.deepEqual((await call(base, "GET", "/session")).body, { required: false, authenticated: true });
  assert.equal((await call(base, "GET", "/rules")).status, 200);
  assert.equal((await call(base, "POST", "/login", { password: "anything" })).status, 204);
  assert.equal((await call(base, "POST", "/password", { next: "" })).status, 400);
});

test("with a password, only signing in is open, and the cookie it gives opens the rest", async () => {
  const { dir, open, call, logs } = start();
  const base = await open();

  assert.equal((await call(base, "POST", "/password", { next: "short" })).status, 400);
  const set = await call(base, "POST", "/password", { next: "correct horse" });
  assert.equal(set.status, 204);
  assert.match(set.setCookie, /^trakarr_session=[0-9a-f]{64}; HttpOnly; SameSite=Lax; Path=\//);
  assert.equal((await call(base, "GET", "/rules", undefined, set.cookie)).status, 200);

  assert.deepEqual((await call(base, "GET", "/session")).body, { required: true, authenticated: false });
  assert.equal((await call(base, "GET", "/rules")).status, 401);
  assert.equal((await call(base, "PATCH", "/settings", { testMode: false })).status, 401);
  assert.equal((await call(base, "GET", "/rules", undefined, "trakarr_session=forged")).status, 401);

  assert.equal((await call(base, "POST", "/login", { password: "wrong one" })).status, 401);
  const login = await call(base, "POST", "/login", { password: "correct horse" });
  assert.equal(login.status, 204);
  assert.deepEqual((await call(base, "GET", "/session", undefined, login.cookie)).body, { required: true, authenticated: true });
  assert.equal((await call(base, "GET", "/rules", undefined, login.cookie)).status, 200);

  // Only the hash is kept, in a file only the owner reads, and nothing logs the password.
  const file = readFileSync(join(dir, "auth.json"), "utf8");
  assert.match(file, /"password": "scrypt:[0-9a-f]+:[0-9a-f]+"/);
  assert.equal(file.includes("correct horse"), false);
  assert.equal(statSync(join(dir, "auth.json")).mode & 0o777, 0o600);
  const lines = await logs(base, login.cookie);
  assert.equal(JSON.stringify(lines).includes("correct horse"), false);
  assert.deepEqual(
    lines.map((l) => l.message).filter((m) => /password|Sign/i.test(m)),
    ["Rejected: The password needs at least 8 characters", "Password set", "Sign-in failed: wrong password", "Signed in"],
  );
});

test("a session outlives a restart, and signing out ends it", async () => {
  const { open, call } = start();
  const first = await open();
  await call(first, "POST", "/password", { next: "correct horse" });
  const { cookie } = await call(first, "POST", "/login", { password: "correct horse" });

  const base = await open();
  assert.equal((await call(base, "GET", "/rules", undefined, cookie)).status, 200);

  const out = await call(base, "POST", "/logout", undefined, cookie);
  assert.equal(out.status, 204);
  assert.match(out.setCookie, /Max-Age=0/);
  assert.equal((await call(base, "GET", "/rules", undefined, cookie)).status, 401);
});

test("changing the password needs the current one and ends the other sessions", async () => {
  const { open, call } = start();
  const base = await open();
  await call(base, "POST", "/password", { next: "correct horse" });
  const other = (await call(base, "POST", "/login", { password: "correct horse" })).cookie;
  const mine = (await call(base, "POST", "/login", { password: "correct horse" })).cookie;

  const wrong = await call(base, "POST", "/password", { current: "nope nope", next: "battery staple" }, mine);
  assert.deepEqual([wrong.status, wrong.body.error], [400, "The current password is wrong"]);
  assert.equal((await call(base, "GET", "/rules", undefined, mine)).status, 200);

  const changed = await call(base, "POST", "/password", { current: "correct horse", next: "battery staple" }, mine);
  assert.equal(changed.status, 204);
  assert.equal((await call(base, "GET", "/rules", undefined, other)).status, 401);
  assert.equal((await call(base, "GET", "/rules", undefined, mine)).status, 401);
  assert.equal((await call(base, "GET", "/rules", undefined, changed.cookie)).status, 200);
  assert.equal((await call(base, "POST", "/login", { password: "correct horse" })).status, 401);
  assert.equal((await call(base, "POST", "/login", { password: "battery staple" })).status, 204);
});

test("removing the password needs the current one and opens the dashboard", async () => {
  const { open, call } = start();
  const base = await open();
  const { cookie } = await call(base, "POST", "/password", { next: "correct horse" });

  assert.equal((await call(base, "POST", "/password", { next: "" }, cookie)).status, 400);
  assert.equal((await call(base, "POST", "/password", { current: "correct horse", next: "" }, cookie)).status, 204);

  assert.deepEqual((await call(base, "GET", "/session")).body, { required: false, authenticated: true });
  assert.equal((await call(base, "GET", "/rules")).status, 200);
});

test("too many wrong passwords lock the address out, even for the right one", async () => {
  const { open, call } = start();
  const base = await open();
  await call(base, "POST", "/password", { next: "correct horse" });

  for (let i = 0; i < 5; i++) assert.equal((await call(base, "POST", "/login", { password: "wrong one" })).status, 401);
  const locked = await call(base, "POST", "/login", { password: "correct horse" });
  assert.equal(locked.status, 429);
  assert.equal(locked.cookie, "");
});
