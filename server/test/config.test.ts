import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { openConfig } from "../src/config.ts";

const TMP = mkdtempSync(join(import.meta.dirname, ".tmp-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

const rule = (prowlarr: unknown) => ({
  id: "kestrel",
  name: "Kestrel",
  domains: ["kestrel.example"],
  holdBelow: 1,
  releaseAbove: 1.1,
  prowlarr,
});

function folder(name: string, files: { settings?: unknown; rules?: unknown; trackers?: unknown }) {
  const dir = join(TMP, name);
  mkdirSync(dir);
  if (files.settings !== undefined) writeFileSync(join(dir, "settings.json"), JSON.stringify(files.settings));
  if (files.rules !== undefined) writeFileSync(join(dir, "rules.json"), JSON.stringify(files.rules));
  if (files.trackers !== undefined) writeFileSync(join(dir, "trackers.json"), JSON.stringify(files.trackers));
  return dir;
}

test("an install whose rules switched an indexer's profile keeps switching", () => {
  const dir = folder("switching", { rules: [rule({ indexerId: 7, heldProfileId: 2, restoreProfileId: 1 })] });
  assert.equal(openConfig(dir).settings().prowlarr.switchProfiles, true);
  assert.equal(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).prowlarr.switchProfiles, true);
});

test("a saved choice for the switch is never overridden, and a fresh install has it off", () => {
  const switched = rule({ indexerId: 7, heldProfileId: 2, restoreProfileId: 1 });
  const off = folder("off", { settings: { prowlarr: { switchProfiles: false } }, rules: [switched] });
  assert.equal(openConfig(off).settings().prowlarr.switchProfiles, false);

  const plain = folder("plain", { rules: [rule(null)] });
  assert.equal(openConfig(plain).settings().prowlarr.switchProfiles, false);
});

test("a total bought before purchases were kept becomes one purchase with no date, the same on every load", () => {
  const GIB = 1024 ** 3;
  const dir = folder("legacy", {
    trackers: [
      { domain: "kestrel.example", bought: 130 * GIB, freeleech: null, pinned: true },
      { domain: "meridian.example", freeleech: null, pinned: true },
    ],
  });
  const expected = [
    {
      domain: "kestrel.example",
      purchases: [{ id: "earlier", bytes: 130 * GIB, at: null }],
      freeleech: null,
      pinned: true,
    },
    { domain: "meridian.example", purchases: [], freeleech: null, pinned: true },
  ];
  assert.deepEqual(openConfig(dir).trackers(), expected);

  // Saved, it's written as purchases only, and reads back the same.
  const config = openConfig(dir);
  config.saveTrackers(config.trackers());
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "trackers.json"), "utf8")), expected);
  assert.deepEqual(openConfig(dir).trackers(), expected);
});

test("purchases that take back more than was bought are refused", () => {
  const dir = folder("negative", {
    trackers: [{ domain: "kestrel.example", purchases: [{ id: "a", bytes: -5, at: 1 }], freeleech: null, pinned: false }],
  });
  assert.throws(() => openConfig(dir), /purchases can't take back more upload than was bought/);
});
