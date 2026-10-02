import assert from "node:assert/strict";
import { test } from "node:test";
import type { Rule } from "../src/config.ts";
import { matches, nextState, plan, ratioOf, totals, type Held, type LedgerEntry, type Torrent } from "../src/engine.ts";

const rule: Rule = {
  id: "kestrel",
  name: "Kestrel",
  domains: ["kestrel.example"],
  holdBelow: 1,
  releaseAbove: 1.1,
  byBuffer: false,
  action: "throttle",
  prowlarr: null,
  enabled: true,
};

function torrent(hash: string, fields: Partial<Torrent> = {}): Torrent {
  return {
    hash,
    name: hash,
    tags: [],
    domains: [],
    uploaded: 0,
    downloaded: 0,
    dlLimit: -1,
    state: "downloading",
    progress: 0.5,
    ...fields,
  };
}

function entry(fields: Partial<LedgerEntry> & { hash: string }): LedgerEntry {
  return {
    domains: [],
    uploaded: 0,
    downloaded: 0,
    pastUploaded: 0,
    pastDownloaded: 0,
    removed: false,
    freeDownloaded: 0,
    ...fields,
  };
}

function held(hash: string, ruleId = "kestrel"): Held {
  return { hash, ruleId, name: hash, action: "throttle", dlLimit: -1, at: 0 };
}

test("a torrent matches by domain or by subdomain", () => {
  assert.equal(matches(rule, ["kestrel.example"]), true);
  assert.equal(matches(rule, ["tracker.kestrel.example"]), true);
  assert.equal(matches(rule, ["notkestrel.example"]), false);
});

test("the ratio has no limit when nothing was downloaded", () => {
  assert.equal(ratioOf(58, 0), Infinity);
  assert.equal(ratioOf(50, 100), 0.5);
});

test("totals count removed torrents and earlier lives of a hash", () => {
  const ledger = [
    entry({ hash: "a", domains: ["kestrel.example"], uploaded: 10, downloaded: 20, pastUploaded: 5, pastDownloaded: 5 }),
    entry({ hash: "b", domains: ["tracker.kestrel.example"], pastUploaded: 7, pastDownloaded: 3, removed: true }),
    entry({ hash: "c", domains: ["meridian.example"], uploaded: 100, downloaded: 1 }),
  ];
  assert.deepEqual(totals(rule, ledger, []), { uploaded: 22, downloaded: 28 });
});

test("bought upload counts on its domain, and what was downloaded on a freeleech doesn't", () => {
  const ledger = [
    entry({ hash: "a", domains: ["tracker.kestrel.example"], uploaded: 10, downloaded: 50, freeDownloaded: 30 }),
    entry({ hash: "b", domains: ["kestrel.example"], uploaded: 5, downloaded: 5 }),
  ];
  const quotas = [
    { domain: "tracker.kestrel.example", bought: 40, freeleech: null, pinned: false },
    { domain: "meridian.example", bought: 1000, freeleech: null, pinned: false },
  ];
  assert.deepEqual(totals(rule, ledger, quotas), { uploaded: 55, downloaded: 25 });
});

test("the state only changes past the thresholds", () => {
  assert.equal(nextState("ok", 0.99, rule), "held");
  assert.equal(nextState("ok", 1.05, rule), "ok");
  assert.equal(nextState("held", 1.05, rule), "held");
  assert.equal(nextState("held", 1.11, rule), "ok");
  assert.equal(nextState("ok", Infinity, rule), "ok");
});

test("a rule on the buffer holds below ratio 1 whatever its own ratios say", () => {
  const lenient = { ...rule, holdBelow: 0.5, releaseAbove: 0.8 };
  assert.equal(nextState("ok", 0.9, lenient), "ok");
  assert.equal(nextState("ok", 0.9, { ...lenient, byBuffer: true }), "held");
  assert.equal(nextState("held", 1.05, { ...lenient, byBuffer: true }), "held");
  assert.equal(nextState("held", 1.11, { ...lenient, byBuffer: true }), "ok");
  assert.equal(nextState("ok", Infinity, { ...lenient, byBuffer: true }), "ok");
});

test("a held rule holds its downloads, and not completed or stopped torrents", () => {
  const torrents = new Map(
    [
      torrent("dl", { domains: ["kestrel.example"] }),
      torrent("done", { domains: ["kestrel.example"], progress: 1, state: "uploading" }),
      torrent("stopped", { domains: ["kestrel.example"], state: "stoppedDL" }),
      torrent("other", { domains: ["meridian.example"] }),
    ].map((t) => [t.hash, t]),
  );
  const result = plan([rule], new Map([["kestrel", "held"]]), torrents, new Map(), []);
  assert.deepEqual([...result.hold.keys()], ["kestrel"]);
  assert.deepEqual(result.hold.get("kestrel")?.map((t) => t.hash), ["dl"]);
  assert.deepEqual(result.release, []);
});

test("holds are released when the rule is OK, paused or gone, and forgotten when the torrent is", () => {
  const torrents = new Map([["dl", torrent("dl", { domains: ["kestrel.example"] })]]);
  const current = new Map([
    ["dl", held("dl")],
    ["removed", held("removed")],
  ]);
  const release = (rules: Rule[], state: "ok" | "held") => plan(rules, new Map([["kestrel", state]]), torrents, current, []);

  assert.deepEqual(release([rule], "held").release, []);
  assert.deepEqual(release([rule], "ok").release.map((h) => h.hash), ["dl"]);
  assert.deepEqual(release([{ ...rule, enabled: false }], "held").release.map((h) => h.hash), ["dl"]);
  assert.deepEqual(release([], "held").release.map((h) => h.hash), ["dl"]);
  assert.deepEqual(release([rule], "held").gone, ["removed"]);
});

test("a torrent on a freeleech is never held, and what it held is released", () => {
  const torrents = new Map(
    [
      torrent("free", { domains: ["tracker.kestrel.example"] }),
      torrent("paid", { domains: ["kestrel.example"] }),
      torrent("was held", { domains: ["tracker.kestrel.example"] }),
    ].map((t) => [t.hash, t]),
  );
  const result = plan([rule], new Map([["kestrel", "held"]]), torrents, new Map([["was held", held("was held")]]), [
    "tracker.kestrel.example",
  ]);
  assert.deepEqual(result.hold.get("kestrel")?.map((t) => t.hash), ["paid"]);
  assert.deepEqual(result.release.map((h) => h.hash), ["was held"]);
});
