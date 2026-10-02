import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import { openConfig, parseRule, type Rule } from "../src/config.ts";
import { createLog } from "../src/log.ts";
import type { Notification } from "../src/notify.ts";
import { openStore, type Store } from "../src/store.ts";
import { createWatcher } from "../src/watcher.ts";
import { startFakeProwlarr, type FakeProwlarr } from "./fake-prowlarr.ts";
import { startFakeQbit, type FakeQbit, type FakeTorrent } from "./fake-qbit.ts";

// Each test file has its own working folder, since node --test runs them in parallel.
const TMP = mkdtempSync(join(import.meta.dirname, ".tmp-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

const KESTREL: Rule = {
  id: "kestrel",
  name: "Kestrel",
  domains: ["kestrel.example"],
  holdBelow: 1,
  releaseAbove: 1.1,
  action: "throttle",
  prowlarr: null,
  enabled: true,
};

const ANNOUNCE = "https://tracker.kestrel.example/announce/PASSKEY123";

const HOUR = 60 * 60 * 1000;

let fake: FakeQbit;
beforeEach(async () => {
  fake = await startFakeQbit();
});
afterEach(() => fake.close());

function torrent(fields: Partial<FakeTorrent>): FakeTorrent {
  return {
    name: "Nosferatu.1922",
    tags: "",
    uploaded: 0,
    downloaded: 0,
    dl_limit: -1,
    state: "downloading",
    progress: 0.4,
    trackers: [],
    ...fields,
  };
}

// A completed torrent that puts Kestrel at 400 / 1100 = 0.364 with the download below.
function seedBelowLimit() {
  fake.torrents.set("seed", torrent({ trackers: [ANNOUNCE], uploaded: 400, downloaded: 1000, state: "uploading", progress: 1 }));
  fake.torrents.set("dl", torrent({ downloaded: 100, trackers: [ANNOUNCE] }));
}

function setup({ rules = [KESTREL], testMode = false, apiKey = "", store, prowlarr }: {
  rules?: Rule[];
  testMode?: boolean;
  apiKey?: string;
  store?: Store;
  prowlarr?: FakeProwlarr;
} = {}) {
  const dir = mkdtempSync(join(TMP, "case-"));
  const config = openConfig(dir);
  config.saveSettings({
    ...config.settings(),
    qbittorrent: { address: fake.address, apiKey },
    prowlarr: { address: prowlarr?.address ?? "", apiKey: prowlarr?.apiKey ?? "" },
    testMode,
  });
  config.saveRules(rules.map((rule) => parseRule(rule, rule.id)));
  const db = store ?? openStore(join(dir, "trakarr.db"));
  const notified: Notification[] = [];
  const watcher = createWatcher({
    config,
    store: db,
    log: createLog(db, "debug", false),
    notify: (notification) => notified.push(notification),
  });
  return { config, store: db, watcher, notified };
}

test("test mode reports the hold and changes nothing", async () => {
  seedBelowLimit();
  const { watcher, store } = setup({ testMode: true });

  await watcher.tick();
  await watcher.tick();

  assert.deepEqual(fake.calls, []);
  const status = watcher.status();
  assert.equal(status.rules[0]?.state, "held");
  assert.deepEqual(status.held.map((h) => h.hash), ["dl"]);
  const events = store.events(10);
  assert.deepEqual(events.map((e) => e.text), ["Kestrel fell to 0.364 and would hold 1 download"]);
  assert.equal(events[0]?.testMode, true);
});

test("holds downloads below the limit and releases them above the release ratio", async () => {
  seedBelowLimit();
  const { watcher, store } = setup();

  await watcher.tick();
  assert.deepEqual(fake.calls, ["setDownloadLimit dl 1024", "addTags dl trakarr-hold"]);
  assert.equal(fake.torrents.get("dl")?.dl_limit, 1024);

  fake.calls = [];
  fake.torrents.get("seed")!.uploaded = 2000;
  await watcher.tick();
  assert.deepEqual(fake.calls, ["setDownloadLimit dl -1", "removeTags dl trakarr-hold"]);
  assert.deepEqual(watcher.status().held, []);
  assert.deepEqual(
    store.events(10).map((e) => e.text),
    ["Kestrel reached 1.818 and released 1 download", "Kestrel fell to 0.364 and held 1 download"],
  );
});

test("a stopped download is started again on release", async () => {
  seedBelowLimit();
  const { watcher } = setup({ rules: [{ ...KESTREL, action: "stop" }] });

  await watcher.tick();
  fake.torrents.get("seed")!.uploaded = 2000;
  await watcher.tick();

  assert.deepEqual(fake.calls, ["stop dl", "addTags dl trakarr-hold", "start dl", "removeTags dl trakarr-hold"]);
});

test("a download that arrives while the rule is held is held too", async () => {
  seedBelowLimit();
  const { watcher, store } = setup();
  await watcher.tick();

  fake.calls = [];
  fake.torrents.set("new", torrent({ trackers: [ANNOUNCE], downloaded: 1 }));
  await watcher.tick();

  assert.deepEqual(fake.calls, ["setDownloadLimit new 1024", "addTags new trakarr-hold"]);
  assert.equal(store.events(1)[0]?.text, "Kestrel held a new download on arrival");
});

test("the user's own download limit comes back on release", async () => {
  seedBelowLimit();
  fake.torrents.get("dl")!.dl_limit = 5000;
  const { watcher } = setup();

  await watcher.tick();
  fake.torrents.get("seed")!.uploaded = 2000;
  await watcher.tick();

  assert.equal(fake.torrents.get("dl")?.dl_limit, 5000);
});

test("pausing a rule releases what it holds", async () => {
  seedBelowLimit();
  const { watcher, config, store } = setup();
  await watcher.tick();

  config.saveRules([{ ...KESTREL, enabled: false }]);
  fake.calls = [];
  await watcher.tick();

  assert.deepEqual(fake.calls, ["setDownloadLimit dl -1", "removeTags dl trakarr-hold"]);
  assert.equal(store.events(1)[0]?.text, "Kestrel released 1 download it no longer holds");
});

test("after a restart, what a deleted rule held is released", async () => {
  seedBelowLimit();
  const first = setup();
  await first.watcher.tick();
  first.watcher.stop();

  fake.calls = [];
  const second = setup({ rules: [], store: first.store });
  await second.watcher.tick();

  assert.deepEqual(fake.calls, ["setDownloadLimit dl -1", "removeTags dl trakarr-hold"]);
});

test("tagged torrents with no record are released", async () => {
  fake.torrents.set("dl", torrent({ tags: "trakarr-hold", dl_limit: 1024 }));
  const { watcher } = setup({ rules: [] });

  await watcher.tick();

  assert.deepEqual(fake.calls, ["setDownloadLimit dl -1", "removeTags dl trakarr-hold"]);
});

test("a removed torrent still counts toward the ratio", async () => {
  fake.torrents.set("seed", torrent({ trackers: [ANNOUNCE], uploaded: 1000, downloaded: 800, state: "uploading", progress: 1 }));
  fake.torrents.set("dl", torrent({ trackers: [ANNOUNCE], downloaded: 100 }));
  const { watcher } = setup();
  await watcher.tick();

  fake.torrents.delete("seed");
  await watcher.tick();

  assert.deepEqual(fake.calls, []);
  assert.deepEqual(watcher.status().rules[0], { id: "kestrel", state: "ok", uploaded: 1000, downloaded: 900, torrents: 1 });
});

test("nothing changes while qBittorrent can't be reached", async () => {
  seedBelowLimit();
  fake.down = true;
  const { watcher } = setup();

  await watcher.tick();

  assert.deepEqual(fake.calls, []);
  assert.equal(watcher.status().qbittorrent.ok, false);
  assert.equal(watcher.status().rules[0]?.state, "ok");
});

test("a qBittorrent with no address yet is no warning", async () => {
  const { watcher, config, store } = setup();
  config.saveSettings({ ...config.settings(), qbittorrent: { address: "", apiKey: "" } });

  await watcher.tick();

  const lines = store.logs({ levels: ["debug", "info", "warn", "error"], query: "qBittorrent", before: Infinity, limit: 10 });
  assert.deepEqual(
    lines.map((l) => [l.level, l.message]),
    [["info", "qBittorrent isn't set up yet, waiting for its address in Settings"]],
  );
});

test("sends the API key when qBittorrent asks for it", async () => {
  fake.apiKey = "qbt_secret";
  seedBelowLimit();
  const { watcher } = setup({ apiKey: "qbt_secret" });

  await watcher.tick();

  assert.deepEqual(watcher.status().qbittorrent.ok, true);
  assert.deepEqual(fake.calls, ["setDownloadLimit dl 1024", "addTags dl trakarr-hold"]);
});

test("a rejected API key is reported as a credentials problem", async () => {
  fake.apiKey = "qbt_secret";
  const { watcher } = setup({ apiKey: "qbt_wrong" });

  await watcher.tick();

  const { qbittorrent } = watcher.status();
  assert.equal(qbittorrent.ok, false);
  assert.equal(!qbittorrent.ok && qbittorrent.reason, "credentials");
  assert.equal(!qbittorrent.ok && qbittorrent.message, "qBittorrent rejected the API key (403)");
});

test("a missing API key says it's needed", async () => {
  fake.apiKey = "qbt_secret";
  const { watcher } = setup();

  await watcher.tick();

  const { qbittorrent } = watcher.status();
  assert.equal(!qbittorrent.ok && qbittorrent.message, "qBittorrent asks for an API key and none is set");
});

test("the passkey in an announce URL is never stored or shown", async () => {
  seedBelowLimit();
  const { watcher, store } = setup();

  await watcher.tick();

  const kept = JSON.stringify({
    status: watcher.status(),
    ledger: [...store.ledger()],
    logs: store.logs({ levels: ["debug", "info", "warn", "error"], query: "", before: Infinity, limit: 1000 }),
    events: store.events(100),
  });
  assert.equal(kept.includes("PASSKEY123"), false);
  assert.equal(kept.includes("tracker.kestrel.example"), true);
});

test("the status lists every tracker the torrents announce to, with its rule", async () => {
  seedBelowLimit();
  fake.torrents.set("open", torrent({ uploaded: 30, downloaded: 10, trackers: ["udp://open.example:1337/announce", ANNOUNCE] }));
  const { watcher, store } = setup({ testMode: true });
  const messages = () =>
    store.logs({ levels: ["info"], query: "tracker", before: Infinity, limit: 10 }).map((l) => [l.message, l.fields]);

  await watcher.tick();

  assert.deepEqual(watcher.status().trackers, [
    { domain: "open.example", ruleId: null, torrents: 1, uploaded: 30, downloaded: 10, bought: 0, freeleech: null, pinned: false },
    {
      domain: "tracker.kestrel.example",
      ruleId: "kestrel",
      torrents: 3,
      uploaded: 430,
      downloaded: 1110,
      bought: 0,
      freeleech: null,
      pinned: false,
    },
  ]);
  assert.deepEqual(messages(), [["Found trackers", { trackers: 2, torrents: 3 }]]);

  fake.torrents.set("new", torrent({ trackers: ["https://new.example/announce"] }));
  fake.torrents.delete("open");
  await watcher.tick();

  assert.deepEqual(
    watcher.status().trackers.map((t) => t.domain),
    ["new.example", "tracker.kestrel.example"],
  );
  assert.deepEqual(messages().slice(1), [
    ["Found new trackers", { domains: "new.example" }],
    ["No torrent announces to these trackers anymore", { domains: "open.example" }],
  ]);
});

test("the status says which trackers are pinned, and a freeleech ending keeps the pin", async () => {
  seedBelowLimit();
  fake.torrents.set("open", torrent({ uploaded: 30, downloaded: 10, trackers: ["udp://open.example:1337/announce"] }));
  const { watcher, config } = setup();
  const now = Date.now();
  config.saveTrackers([
    { domain: "tracker.kestrel.example", bought: 0, freeleech: { from: now - 60_000, until: now }, pinned: true },
  ]);

  await watcher.tick();

  assert.deepEqual(
    watcher.status().trackers.map((t) => [t.domain, t.pinned]),
    [
      ["open.example", false],
      ["tracker.kestrel.example", true],
    ],
  );
  assert.deepEqual(config.trackers(), [{ domain: "tracker.kestrel.example", bought: 0, freeleech: null, pinned: true }]);
});

test("upload bought on a tracker counts toward its rule's ratio", async () => {
  seedBelowLimit();
  const { watcher, config, store } = setup();
  await watcher.tick();

  // 400 + 1000 bought / 1100 = 1.273, past the release ratio.
  config.saveTrackers([{ domain: "tracker.kestrel.example", bought: 1000, freeleech: null, pinned: false }]);
  fake.calls = [];
  await watcher.tick();

  assert.deepEqual(fake.calls, ["setDownloadLimit dl -1", "removeTags dl trakarr-hold"]);
  assert.equal(store.events(1)[0]?.text, "Kestrel reached 1.273 and released 1 download");
  const status = watcher.status();
  assert.deepEqual(status.rules[0], { id: "kestrel", state: "ok", torrents: 2, uploaded: 1400, downloaded: 1100 });
  const tracker = status.trackers.find((t) => t.domain === "tracker.kestrel.example");
  assert.deepEqual([tracker?.uploaded, tracker?.bought], [1400, 1000]);
});

test("on a freeleech, downloads don't count and aren't held, and the rule takes over when it ends", async () => {
  seedBelowLimit();
  const { watcher, config, store } = setup();
  await watcher.tick();
  const rule = () => watcher.status().rules[0];
  assert.equal(rule()?.state, "held");

  const now = Date.now();
  config.saveTrackers([{ domain: "tracker.kestrel.example", bought: 0, freeleech: { from: now - 60_000, until: now + HOUR }, pinned: false }]);
  fake.calls = [];
  await watcher.tick();
  assert.deepEqual(fake.calls, ["setDownloadLimit dl -1", "removeTags dl trakarr-hold"]);

  // Downloaded between two polls on the freeleech: it doesn't count.
  fake.torrents.get("dl")!.downloaded += 500;
  await watcher.tick();
  assert.deepEqual([rule()?.downloaded, rule()?.state], [1100, "held"]);

  // Over: what downloads from now on counts, and the held rule holds again.
  config.saveTrackers([{ domain: "tracker.kestrel.example", bought: 0, freeleech: { from: now - 60_000, until: Date.now() }, pinned: false }]);
  fake.torrents.get("dl")!.downloaded += 100;
  fake.calls = [];
  await watcher.tick();
  assert.deepEqual(fake.calls, ["setDownloadLimit dl 1024", "addTags dl trakarr-hold"]);
  assert.equal(rule()?.downloaded, 1200);
  assert.deepEqual(config.trackers(), []);
  assert.equal(store.events(10).some((e) => e.text === "The freeleech on tracker.kestrel.example ended"), true);
});

test("a freeleech that starts between two polls only counts from the next one", async () => {
  seedBelowLimit();
  const { watcher, config } = setup({ rules: [{ ...KESTREL, enabled: false }] });
  await watcher.tick();

  fake.torrents.get("dl")!.downloaded += 500;
  const from = watcher.status().qbittorrent.lastUpdate! + 1;
  config.saveTrackers([{ domain: "tracker.kestrel.example", bought: 0, freeleech: { from, until: from + HOUR }, pinned: false }]);
  await watcher.tick();

  assert.equal(watcher.status().rules[0]?.downloaded, 1600);
});

// Kestrel's indexer is 7; profile 2 has RSS and automatic search off, 1 is the usual one.
const SWITCHED: Rule = { ...KESTREL, prowlarr: { indexerId: 7, heldProfileId: 2, restoreProfileId: 1 } };

test("a held rule moves its indexer to the held sync profile, and back on release", async (t) => {
  const prowlarr = await startFakeProwlarr();
  t.after(() => prowlarr.close());
  seedBelowLimit();
  const { watcher } = setup({ rules: [SWITCHED], prowlarr });

  await watcher.tick();
  await watcher.tick();
  assert.deepEqual(prowlarr.calls, ["7 2"]);

  fake.torrents.get("seed")!.uploaded = 2000;
  await watcher.tick();
  assert.deepEqual(prowlarr.calls, ["7 2", "7 1"]);
});

test("an indexer switch that fails is tried again on the next poll", async (t) => {
  const prowlarr = await startFakeProwlarr();
  t.after(() => prowlarr.close());
  prowlarr.down = true;
  seedBelowLimit();
  const { watcher, store } = setup({ rules: [SWITCHED], prowlarr });

  await watcher.tick();
  await watcher.tick();
  assert.deepEqual(fake.calls, ["setDownloadLimit dl 1024", "addTags dl trakarr-hold"]);
  const errors = store.events(10).filter((e) => e.kind === "error");
  assert.deepEqual(errors.map((e) => e.text), ["Kestrel couldn't change the indexer's sync profile: Prowlarr returned 503 for indexer/bulk"]);

  prowlarr.down = false;
  await watcher.tick();
  assert.deepEqual(prowlarr.calls, ["7 2"]);
});

test("deleting a held rule puts its indexer back on its usual profile", async (t) => {
  const prowlarr = await startFakeProwlarr();
  t.after(() => prowlarr.close());
  seedBelowLimit();
  const { watcher, config } = setup({ rules: [SWITCHED], prowlarr });
  await watcher.tick();

  config.saveRules([]);
  await watcher.tick();
  await watcher.tick();

  assert.deepEqual(prowlarr.calls, ["7 2", "7 1"]);
});

test("a rule that was never held doesn't touch its indexer", async (t) => {
  const prowlarr = await startFakeProwlarr();
  t.after(() => prowlarr.close());
  fake.torrents.set("seed", torrent({ trackers: [ANNOUNCE], uploaded: 2000, downloaded: 1000, state: "uploading", progress: 1 }));
  const { watcher, config } = setup({ rules: [SWITCHED], prowlarr });

  await watcher.tick();
  config.saveRules([]);
  await watcher.tick();

  assert.deepEqual(prowlarr.calls, []);
});

test("a hold and a release are sent to the user, and test mode says they're only what would happen", async () => {
  seedBelowLimit();
  const { watcher, config, notified } = setup({ testMode: true });
  await watcher.tick();
  assert.deepEqual(notified, [
    { title: "Would hold downloads", message: "Kestrel fell to 0.364 and would hold 1 download", priority: 4 },
  ]);

  notified.length = 0;
  config.saveSettings({ ...config.settings(), testMode: false });
  fake.torrents.get("seed")!.uploaded = 2000;
  await watcher.tick();
  assert.deepEqual(notified.map((n) => n.title), ["Downloads released"]);
});

test("losing qBittorrent is sent, and so is its return, once", async () => {
  seedBelowLimit();
  const { watcher, notified } = setup();
  await watcher.tick();
  notified.length = 0;

  fake.down = true;
  await watcher.tick();
  await watcher.tick();
  assert.deepEqual(notified.map((n) => n.title), ["Problem"]);
  assert.match(notified[0]!.message, /^Lost qBittorrent: /);

  fake.down = false;
  await watcher.tick();
  await watcher.tick();
  assert.deepEqual(notified.map((n) => n.title), ["Problem", "qBittorrent is back"]);
});

test("a freeleech about to end is sent once, and not while it still has long to run", async () => {
  const { watcher, config, notified } = setup();
  const now = Date.now();
  config.saveTrackers([{ domain: "tracker.kestrel.example", bought: 0, freeleech: { from: now, until: now + 3 * HOUR }, pinned: false }]);

  await watcher.tick();
  assert.deepEqual(notified, []);

  config.saveTrackers([{ domain: "tracker.kestrel.example", bought: 0, freeleech: { from: now, until: now + 30 * 60_000 }, pinned: false }]);
  await watcher.tick();
  await watcher.tick();
  assert.deepEqual(notified, [{ title: "Freeleech ending", message: "The freeleech on tracker.kestrel.example ends in 30 min" }]);
});
