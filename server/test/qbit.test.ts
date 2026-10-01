import assert from "node:assert/strict";
import { test } from "node:test";
import { applyMaindata, emptySnapshot, torrentsOf } from "../src/qbit.ts";

const ANNOUNCE = "https://tracker.kestrel.example/announce/PASSKEY123";

test("maindata diffs merge into the snapshot", () => {
  const snapshot = emptySnapshot();
  applyMaindata(snapshot, {
    rid: 1,
    full_update: true,
    torrents: {
      a: { name: "A", tags: "kestrel, movies", uploaded: 10, downloaded: 20, dl_limit: -1, state: "downloading", progress: 0.5 },
      b: { name: "B", tags: "", uploaded: 1, downloaded: 1, dl_limit: -1, state: "uploading", progress: 1 },
    },
    trackers: { [ANNOUNCE]: ["a"], "udp://open.example:1337/announce": ["a", "b"] },
  });
  applyMaindata(snapshot, {
    rid: 2,
    torrents: { a: { uploaded: 15, progress: 0.6 } },
    torrents_removed: ["b"],
    trackers: { "udp://open.example:1337/announce": ["a"] },
  });

  const torrents = torrentsOf(snapshot);
  assert.equal(snapshot.rid, 2);
  assert.deepEqual([...torrents.keys()], ["a"]);
  const a = torrents.get("a");
  assert.equal(a?.uploaded, 15);
  assert.equal(a?.downloaded, 20);
  assert.equal(a?.progress, 0.6);
  assert.deepEqual(a?.tags, ["kestrel", "movies"]);
  assert.deepEqual(a?.domains.sort(), ["open.example", "tracker.kestrel.example"]);

  applyMaindata(snapshot, { rid: 3, trackers_removed: [ANNOUNCE] });
  assert.deepEqual(torrentsOf(snapshot).get("a")?.domains, ["open.example"]);
});

test("a full update replaces the snapshot", () => {
  const snapshot = emptySnapshot();
  applyMaindata(snapshot, { rid: 1, full_update: true, torrents: { a: { name: "A" } } });
  applyMaindata(snapshot, { rid: 1, full_update: true, torrents: { b: { name: "B" } } });
  assert.deepEqual([...torrentsOf(snapshot).keys()], ["b"]);
});

test("announce URLs and fields that can carry a passkey aren't kept", () => {
  const snapshot = emptySnapshot();
  const torrent = { name: "A", magnet_uri: `magnet:?tr=${ANNOUNCE}`, tracker: ANNOUNCE } as Record<string, unknown>;
  applyMaindata(snapshot, { rid: 1, full_update: true, torrents: { a: torrent }, trackers: { [ANNOUNCE]: ["a"] } });
  const kept = JSON.stringify({ torrents: [...snapshot.torrents], trackers: [...snapshot.trackers], views: [...torrentsOf(snapshot)] });
  assert.equal(kept.includes("PASSKEY123"), false);
  assert.equal(kept.includes("tracker.kestrel.example"), true);
});
