import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApi } from "../src/api.ts";
import { openConfig } from "../src/config.ts";
import { createLog } from "../src/log.ts";
import { openStore, type Store } from "../src/store.ts";
import { createWatcher, type Watcher } from "../src/watcher.ts";
import { startFakeNtfy } from "./fake-ntfy.ts";
import { startFakeQbit, type FakeQbit } from "./fake-qbit.ts";

let dir: string;
let fake: FakeQbit;
let server: Server;
let base: string;
let store: Store;
let watcher: Watcher;

before(async () => {
  dir = mkdtempSync(join(import.meta.dirname, ".tmp-"));
  fake = await startFakeQbit();
  fake.apiKey = "qbt_secret";
  const config = openConfig(dir);
  config.saveSettings({ ...config.settings(), qbittorrent: { address: fake.address, apiKey: "qbt_secret" } });
  store = openStore(join(dir, "trakarr.db"));
  const log = createLog(store, "debug", false);
  watcher = createWatcher({ config, store, log, notify: () => {} });
  server = createApi({ config, store, log, watcher }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  server.close();
  await fake.close();
  rmSync(dir, { recursive: true, force: true });
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test("settings never show their secrets, and an empty one keeps the saved value", async () => {
  const saved = await call("GET", "/settings");
  assert.deepEqual(saved.body.qbittorrent, { address: fake.address, hasApiKey: true });
  assert.equal(JSON.stringify(saved.body).includes("secret"), false);

  const patched = await call("PATCH", "/settings", { qbittorrent: { apiKey: "" }, pollSeconds: 10 });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.pollSeconds, 10);
  const file = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
  assert.equal(file.qbittorrent.apiKey, "qbt_secret");
});

test("a connection test uses the saved secret when none is sent", async () => {
  assert.deepEqual((await call("POST", "/test/qbittorrent", { address: fake.address })).body, { ok: true, version: "5.2.3" });
  assert.deepEqual((await call("POST", "/test/qbittorrent", { apiKey: "qbt_wrong" })).body, {
    ok: false,
    reason: "credentials",
    message: "qBittorrent rejected the API key (403)",
  });
});

test("rules are checked, and a pasted announce URL keeps only its domain", async () => {
  const none = await call("POST", "/rules", { name: "Kestrel", holdBelow: 1, releaseAbove: 1.1 });
  assert.equal(none.status, 400);
  assert.equal(none.body.error, "Add a domain");
  const bad = await call("POST", "/rules", { name: "Kestrel", domains: ["kestrel.example"], holdBelow: 1.1, releaseAbove: 1 });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "releaseAbove must be greater than holdBelow");
  const text = await call("POST", "/rules", {
    name: "Kestrel",
    domains: ["kestrel.example"],
    holdBelow: 1,
    releaseAbove: 1.1,
    byBuffer: "yes",
  });
  assert.equal(text.status, 400);
  assert.equal(text.body.error, "byBuffer must be true or false");

  const created = await call("POST", "/rules", {
    name: "Kestrel",
    domains: ["https://tracker.kestrel.example/announce/PASSKEY123"],
    holdBelow: 1,
    releaseAbove: 1.1,
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.domains, ["tracker.kestrel.example"]);
  assert.equal(created.body.byBuffer, false);
  assert.equal(readFileSync(join(dir, "rules.json"), "utf8").includes("PASSKEY123"), false);

  const paused = await call("PATCH", `/rules/${created.body.id}`, { enabled: false });
  assert.equal(paused.body.enabled, false);
  const events = await call("GET", "/events");
  assert.deepEqual(
    events.body.slice(0, 2).map((e: { text: string }) => e.text),
    ["Kestrel rule paused", "Kestrel rule added"],
  );

  assert.equal((await call("DELETE", `/rules/${created.body.id}`)).status, 204);
  assert.deepEqual((await call("GET", "/rules")).body, []);
});

test("an unknown rule or route is a 404, and broken JSON a 400", async () => {
  assert.equal((await call("PATCH", "/rules/nope", { enabled: false })).status, 404);
  assert.equal((await call("GET", "/nope")).status, 404);
  const res = await fetch(`${base}/rules`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  assert.equal(res.status, 400);
});

test("Prowlarr errors say what to fix", async () => {
  const res = await call("GET", "/prowlarr");
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { error: "Prowlarr isn't set up", reason: "unreachable" });
});

test("a shorter log retention drops the older lines right away", async () => {
  const day = 24 * 60 * 60 * 1000;
  store.addLog({ at: Date.now() - 10 * day, level: "info", scope: "test", message: "ten days old", fields: null });
  store.addLog({ at: Date.now() - day, level: "info", scope: "test", message: "a day old", fields: null });
  const kept = () =>
    store
      .logs({ levels: ["info"], query: "old", before: Infinity, limit: 10 })
      .filter((l) => l.scope === "test")
      .map((l) => l.message);
  assert.deepEqual(kept(), ["ten days old", "a day old"]);

  assert.equal((await call("PATCH", "/settings", { logRetentionDays: 0 })).status, 400);
  const saved = await call("PATCH", "/settings", { logRetentionDays: 7 });
  assert.equal(saved.body.logRetentionDays, 7);
  assert.deepEqual(kept(), ["a day old"]);
});

test("the status says where qBittorrent is and how often it's polled", async () => {
  const { body } = await call("GET", "/status");
  const settings = (await call("GET", "/settings")).body;
  assert.equal(body.qbittorrent.address, fake.address);
  assert.equal(body.pollSeconds, settings.pollSeconds);
  assert.equal(body.testMode, true);
});

test("a preview counts the torrents its domains reach, with their totals", async () => {
  const announce = "https://tracker.kestrel.example/announce/PASSKEY123";
  const seeding = { state: "uploading", progress: 1, dl_limit: -1 };
  fake.torrents.set("tracked", { name: "A", tags: "", uploaded: 300, downloaded: 100, ...seeding, trackers: [announce] });
  fake.torrents.set("sibling", { name: "B", tags: "", uploaded: 50, downloaded: 50, ...seeding, trackers: ["udp://kestrel.example:1337/announce"] });
  fake.torrents.set("other", { name: "C", tags: "", uploaded: 9, downloaded: 9, ...seeding, trackers: ["https://other.example/announce"] });
  await watcher.tick();

  const both = await call("POST", "/rules/preview", { domains: ["kestrel.example", announce] });
  assert.deepEqual(both.body, { torrents: 2, uploaded: 350, downloaded: 150 });
  assert.equal(JSON.stringify(both.body).includes("PASSKEY123"), false);
  assert.deepEqual((await call("POST", "/rules/preview", { domains: ["nothing.example"] })).body, { torrents: 0, uploaded: 0, downloaded: 0 });
  assert.equal((await call("POST", "/rules/preview", { domains: ["nope"] })).status, 400);
});

test("the logs can be tailed from the last id seen", async () => {
  store.addLog({ at: Date.now(), level: "info", scope: "test", message: "first tail line", fields: null });
  const all = (await call("GET", "/logs?q=tail%20line")).body;
  assert.deepEqual(all.map((l: { message: string }) => l.message), ["first tail line"]);
  const lastId = all[0].id;

  assert.deepEqual((await call("GET", `/logs?q=tail%20line&after=${lastId}`)).body, []);
  store.addLog({ at: Date.now(), level: "info", scope: "test", message: "second tail line", fields: null });
  const next = (await call("GET", `/logs?q=tail%20line&after=${lastId}`)).body;
  assert.deepEqual(next.map((l: { message: string }) => l.message), ["second tail line"]);
});

test("everything the UI does is logged, with what it changed and never a secret", async () => {
  const lines = (query: string) =>
    store
      .logs({ levels: ["debug", "info", "warn", "error"], query, before: Infinity, limit: 100 })
      .map((l) => [l.level, l.message, l.fields]);

  const created = await call("POST", "/rules", { name: "Osprey", domains: ["osprey.example"], holdBelow: 1, releaseAbove: 1.1 });
  await call("PATCH", `/rules/${created.body.id}`, { holdBelow: 0.9, byBuffer: true, domains: ["osprey.example", "falcon.example"] });
  await call("DELETE", `/rules/${created.body.id}`);
  assert.deepEqual(lines("Osprey rule"), [
    [
      "info",
      "Osprey rule added",
      {
        name: "Osprey",
        domains: "osprey.example",
        holdBelow: 1,
        releaseAbove: 1.1,
        byBuffer: false,
        action: "throttle",
        prowlarr: "off",
        enabled: true,
      },
    ],
    [
      "info",
      "Osprey rule edited",
      { domains: "osprey.example → osprey.example, falcon.example", holdBelow: "1 → 0.9", byBuffer: "false → true" },
    ],
    [
      "info",
      "Osprey rule deleted",
      {
        name: "Osprey",
        domains: "osprey.example, falcon.example",
        holdBelow: 0.9,
        releaseAbove: 1.1,
        byBuffer: true,
        action: "throttle",
        prowlarr: "off",
        enabled: true,
      },
    ],
  ]);

  await call("PATCH", "/settings", { qbittorrent: { apiKey: "qbt_hunter2" }, pollSeconds: 30 });
  assert.deepEqual(lines("10 → 30")[0], [
    "info",
    "Settings saved",
    { pollSeconds: "10 → 30", "qbittorrent.apiKey": "<redacted>" },
  ]);
  await call("PATCH", "/settings", { qbittorrent: { apiKey: "qbt_secret" }, pollSeconds: 10 });

  const bad = await call("PATCH", "/settings", { prowlarr: { switchProfiles: "yes" } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "prowlarr.switchProfiles must be true or false");
  assert.equal((await call("PATCH", "/settings", { prowlarr: { switchProfiles: true } })).body.prowlarr.switchProfiles, true);
  assert.deepEqual(lines("switchProfiles").filter(([level]) => level === "info"), [
    ["info", "Settings saved", { "prowlarr.switchProfiles": "false → true" }],
  ]);
  await call("PATCH", "/settings", { prowlarr: { switchProfiles: false } });

  await call("POST", "/test/qbittorrent", { apiKey: "qbt_wrong" });
  assert.deepEqual(lines("Connection test").at(-1), [
    "warn",
    "Connection test to qBittorrent failed",
    { address: fake.address, error: "qBittorrent rejected the API key (403)" },
  ]);

  await call("PATCH", "/rules/nope", { enabled: false });
  await call("POST", "/rules", { name: "" });
  await call("GET", "/prowlarr");
  assert.deepEqual(lines("request").slice(-3), [
    ["warn", "No such rule", { request: "PATCH /api/rules/nope" }],
    ["warn", "Rejected: name is required", { request: "POST /api/rules" }],
    ["warn", "Prowlarr isn't set up", { request: "GET /api/prowlarr" }],
  ]);

  const all = JSON.stringify(lines(""));
  assert.equal(all.includes("hunter2"), false);
  assert.equal(all.includes("wrong"), false);
});

test("bought upload is added a purchase at a time, and a freeleech starts and ends, all logged", async () => {
  const GIB = 1024 ** 3;
  const path = "/trackers/harrier.example";
  const lines = () =>
    store
      .logs({ levels: ["info"], query: "harrier.example", before: Infinity, limit: 10 })
      .map((l) => [l.message, l.fields]);

  assert.deepEqual((await call("PATCH", path, { addBought: 30 * GIB })).body, {
    domain: "harrier.example",
    bought: 30 * GIB,
    freeleech: null,
    pinned: false,
  });
  assert.equal((await call("PATCH", path, { addBought: 30 * GIB })).body.bought, 60 * GIB);
  const tooMuch = await call("PATCH", path, { addBought: -61 * GIB });
  assert.deepEqual([tooMuch.status, tooMuch.body.error], [400, "That takes back more upload than was bought"]);
  assert.equal((await call("PATCH", path, { addBought: -10 * GIB })).body.bought, 50 * GIB);

  const started = Date.now();
  const { freeleech } = (await call("PATCH", path, { freeleechHours: 24 })).body;
  assert.equal(freeleech.until - freeleech.from, 24 * 60 * 60 * 1000);
  assert.equal(freeleech.from >= started, true);
  assert.equal((await call("PATCH", path, { freeleechHours: null })).body.freeleech, null);

  assert.equal((await call("PATCH", path, { freeleechHours: 0 })).status, 400);
  assert.equal((await call("PATCH", "/trackers/nope", { addBought: GIB })).status, 400);

  const until = new Date(freeleech.until).toISOString();
  assert.deepEqual(lines(), [
    ["Added 30 GiB of bought upload to harrier.example", { bought: "0 GiB → 30 GiB" }],
    ["Added 30 GiB of bought upload to harrier.example", { bought: "30 GiB → 60 GiB" }],
    ["Took back 10 GiB of bought upload from harrier.example", { bought: "60 GiB → 50 GiB" }],
    ["Freeleech on harrier.example for 24h", { until }],
    ["Ended the freeleech on harrier.example", { until }],
  ]);
  assert.deepEqual(
    (await call("GET", "/events?limit=2")).body.map((e: { kind: string; text: string }) => [e.kind, e.text]),
    [
      ["tracker", "Ended the freeleech on harrier.example"],
      ["tracker", "Freeleech on harrier.example for 24h"],
    ],
  );
});

test("a tracker is pinned and unpinned, kept in trackers.json only while it has something to keep, and logged when it changes", async () => {
  const GIB = 1024 ** 3;
  const kept = (domain: string) =>
    (JSON.parse(readFileSync(join(dir, "trackers.json"), "utf8")) as { domain: string }[]).filter((t) => t.domain === domain);
  const lines = (domain: string) =>
    store
      .logs({ levels: ["info"], query: domain, before: Infinity, limit: 10 })
      .map((l) => [l.message, l.fields]);
  const path = "/trackers/kite.example";

  assert.deepEqual((await call("PATCH", path, { pinned: true })).body, {
    domain: "kite.example",
    bought: 0,
    freeleech: null,
    pinned: true,
  });
  assert.deepEqual(kept("kite.example"), [{ domain: "kite.example", bought: 0, freeleech: null, pinned: true }]);

  // Pinning what's pinned changes nothing, and neither does buying upload.
  assert.equal((await call("PATCH", path, { pinned: true })).body.pinned, true);
  assert.equal((await call("PATCH", path, { addBought: GIB })).body.pinned, true);

  // Unpinned with upload bought, it stays for the upload.
  assert.equal((await call("PATCH", path, { pinned: false })).body.pinned, false);
  assert.deepEqual(kept("kite.example"), [{ domain: "kite.example", bought: GIB, freeleech: null, pinned: false }]);

  // Unpinned with nothing else, it goes.
  const swift = "/trackers/swift.example";
  await call("PATCH", swift, { pinned: true });
  await call("PATCH", swift, { pinned: false });
  assert.deepEqual(kept("swift.example"), []);

  const invalid = await call("PATCH", path, { pinned: "yes" });
  assert.deepEqual([invalid.status, invalid.body.error], [400, "pinned must be true or false"]);

  assert.deepEqual(lines("kite.example"), [
    ["Pinned kite.example", { pinned: "false → true" }],
    ["Added 1 GiB of bought upload to kite.example", { bought: "0 GiB → 1 GiB" }],
    ["Unpinned kite.example", { pinned: "true → false" }],
  ]);
  assert.deepEqual(lines("swift.example"), [
    ["Pinned swift.example", { pinned: "false → true" }],
    ["Unpinned swift.example", { pinned: "true → false" }],
  ]);
});

test("ntfy's token never shows, a topic is checked, and a test sends a real message", async () => {
  const ntfy = await startFakeNtfy();
  try {
    ntfy.token = "tk_secret";
    const bad = await call("PATCH", "/settings", { ntfy: { topic: "not a topic" } });
    assert.equal(bad.status, 400);

    const saved = await call("PATCH", "/settings", { ntfy: { address: ntfy.address, topic: "trakarr", token: "tk_secret" } });
    assert.deepEqual(saved.body.ntfy, { address: ntfy.address, topic: "trakarr", hasToken: true });
    assert.equal(JSON.stringify(saved.body).includes("tk_secret"), false);

    assert.deepEqual((await call("POST", "/test/ntfy")).body, { ok: true });
    assert.deepEqual(ntfy.messages.map((m) => [m.topic, m.title]), [["trakarr", "trakarr"]]);
    assert.deepEqual((await call("POST", "/test/ntfy", { token: "tk_wrong" })).body, {
      ok: false,
      reason: "credentials",
      message: "ntfy rejected the access token (403)",
    });

    const lines = (await call("GET", "/logs?q=ntfy")).body as { level: string; message: string; fields: Record<string, unknown> | null }[];
    const changed = lines.find((l) => l.message === "Settings saved" && l.fields?.["ntfy.token"]);
    assert.equal(changed?.fields?.["ntfy.token"], "<redacted>");
    assert.equal(changed?.fields?.["ntfy.topic"], "none → trakarr");
    assert.deepEqual(
      lines.filter((l) => /test notification/i.test(l.message)).map((l) => l.level),
      ["info", "warn"],
    );
  } finally {
    await ntfy.close();
  }
});

test("the time zone, clock and language are checked, and a time zone can go back to the browser's", async () => {
  const saved = await call("PATCH", "/settings", { timeZone: "America/Argentina/Buenos_Aires", clock: "12", language: "es" });
  assert.deepEqual([saved.body.timeZone, saved.body.clock, saved.body.language], ["America/Argentina/Buenos_Aires", "12", "es"]);

  assert.equal((await call("PATCH", "/settings", { timeZone: "Mars/Olympus" })).body.error, "Mars/Olympus isn't a time zone");
  assert.equal((await call("PATCH", "/settings", { clock: "13" })).body.error, "clock must be 12 or 24");
  assert.equal((await call("PATCH", "/settings", { language: "fr" })).body.error, "language must be en or es");

  const back = await call("PATCH", "/settings", { timeZone: "", clock: "24", language: "en" });
  assert.deepEqual([back.body.timeZone, back.body.clock, back.body.language], ["", "24", "en"]);
  const lines = (await call("GET", "/logs?q=timeZone")).body as { fields: Record<string, unknown> }[];
  assert.equal(lines.some((l) => l.fields.timeZone === "America/Argentina/Buenos_Aires → none"), true);
});
