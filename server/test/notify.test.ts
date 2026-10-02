import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { openConfig } from "../src/config.ts";
import { createLog } from "../src/log.ts";
import { createNotifier } from "../src/notify.ts";
import { openStore } from "../src/store.ts";
import { startFakeNtfy, type FakeNtfy } from "./fake-ntfy.ts";

const TMP = mkdtempSync(join(import.meta.dirname, ".tmp-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

let fake: FakeNtfy;
beforeEach(async () => {
  fake = await startFakeNtfy();
});
afterEach(() => fake.close());

function setup(ntfy: { address: string; topic: string; token: string }) {
  const dir = mkdtempSync(join(TMP, "case-"));
  const config = openConfig(dir);
  config.saveSettings({ ...config.settings(), ntfy });
  const store = openStore(join(dir, "trakarr.db"));
  const notifier = createNotifier({ config, log: createLog(store, "debug", false) });
  const lines = () => store.logs({ levels: ["info", "warn"], query: "notification", before: Infinity, limit: 10 });
  return { notifier, lines };
}

test("a notification goes to the topic as JSON, with the token when there is one", async () => {
  fake.token = "tk_secret";
  const { notifier, lines } = setup({ address: fake.address, topic: "trakarr", token: "tk_secret" });

  notifier.notify({ title: "Downloads held", message: "Kestrel fell to 0.36 and held 1 download", priority: 4 });
  await notifier.settled();

  assert.deepEqual(fake.messages, [
    { topic: "trakarr", title: "Downloads held", message: "Kestrel fell to 0.36 and held 1 download", priority: 4 },
  ]);
  assert.deepEqual(lines().map((l) => [l.level, l.message, l.fields]), [
    ["info", "Sent a notification", { title: "Downloads held", topic: "trakarr" }],
  ]);
});

test("without an address or a topic nothing is sent", async () => {
  const noTopic = setup({ address: fake.address, topic: "", token: "" });
  noTopic.notifier.notify({ title: "x", message: "y" });
  const noAddress = setup({ address: "", topic: "trakarr", token: "" });
  noAddress.notifier.notify({ title: "x", message: "y" });
  await Promise.all([noTopic.notifier.settled(), noAddress.notifier.settled()]);

  assert.deepEqual(fake.messages, []);
  assert.deepEqual(noTopic.lines(), []);
});

test("a server that refuses or is down is a warning, never a failure of the caller", async () => {
  fake.token = "tk_secret";
  const refused = setup({ address: fake.address, topic: "trakarr", token: "tk_wrong" });
  refused.notifier.notify({ title: "a", message: "b" });
  await refused.notifier.settled();
  assert.deepEqual(refused.lines().map((l) => [l.level, l.message, l.fields?.error]), [
    ["warn", "Couldn't send a notification", "ntfy rejected the access token (403)"],
  ]);

  const open = setup({ address: fake.address, topic: "trakarr", token: "" });
  open.notifier.notify({ title: "a", message: "b" });
  await open.notifier.settled();
  assert.equal(open.lines()[0]?.fields?.error, "ntfy asks for an access token and none is set");

  fake.token = null;
  fake.down = true;
  const down = setup({ address: fake.address, topic: "trakarr", token: "" });
  down.notifier.notify({ title: "a", message: "b" });
  await down.notifier.settled();
  assert.equal(down.lines()[0]?.fields?.error, "ntfy answered 503");

  const gone = setup({ address: "127.0.0.1:1", topic: "trakarr", token: "" });
  gone.notifier.notify({ title: "a", message: "b" });
  await gone.notifier.settled();
  assert.equal(gone.lines()[0]?.fields?.error, "Can't reach 127.0.0.1:1");
});
