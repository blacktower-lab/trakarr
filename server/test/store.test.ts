import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { openStore } from "../src/store.ts";

const TMP = mkdtempSync(join(import.meta.dirname, ".tmp-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

test("a database from an older version is migrated, and keeps its ledger", () => {
  const path = join(TMP, "old.db");
  const old = new DatabaseSync(path);
  old.exec(`
    CREATE TABLE ledger (
      hash TEXT PRIMARY KEY, tags TEXT NOT NULL, domains TEXT NOT NULL,
      uploaded INTEGER NOT NULL, downloaded INTEGER NOT NULL,
      past_uploaded INTEGER NOT NULL, past_downloaded INTEGER NOT NULL, removed INTEGER NOT NULL
    );
    INSERT INTO ledger VALUES ('a', '[]', '["kestrel.example"]', 10, 20, 0, 0, 0);
  `);
  old.close();

  const store = openStore(path);
  assert.equal(store.ledger().get("a")?.freeDownloaded, 0);
  store.putLedger([{ ...store.ledger().get("a")!, freeDownloaded: 5 }]);
  assert.deepEqual(store.ledger().get("a"), {
    hash: "a",
    domains: ["kestrel.example"],
    uploaded: 10,
    downloaded: 20,
    pastUploaded: 0,
    pastDownloaded: 0,
    removed: false,
    freeDownloaded: 5,
  });
  store.close();
});
