import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GrantKind, MAX_GRANT_CARDS, grantRecord, parseGrantRecord } from "../src/index.js";

const card = (n) => ({ id: `0000000${n % 10}-0000-4000-8000-${String(n).padStart(12, "0")}`, definitionId: "ember_imp", serial: n });
const HEX = "ab".repeat(32);

describe("grant records", () => {
  it("records a starter deck canonically, and reads back only well-formed records", () => {
    const json = grantRecord({ kind: GrantKind.STARTER, account: "alice", cards: [card(1), card(2)], deck: "precon_foundry" });
    assert.equal(json, '{"cards":[["00000001-0000-4000-8000-000000000001","ember_imp",1],["00000002-0000-4000-8000-000000000002","ember_imp",2]],"deck":"precon_foundry","k":"starter","u":"alice","v":1}');
    assert.equal(parseGrantRecord(json).deck, "precon_foundry");
    for (const broken of [json.replace('"v":1', '"v":2'), json.replace('"k":"starter"', '"k":"gift"'), json.replace('"deck":"precon_foundry",', ""), json.replace(',2]]', ',2,"x"]]'), `${json} `, "{}", "[]"]) {
      assert.equal(parseGrantRecord(broken), null, broken.slice(-50));
    }
  });

  it("records a daily pack with its drop table and seed, and nothing a starter has", () => {
    const json = grantRecord({ kind: GrantKind.DAILY, account: "bob", cards: [card(3)], day: "2026-10-15", track: "hard", tableHash: HEX, seed: HEX });
    const record = parseGrantRecord(json);
    assert.deepEqual([record.k, record.u, record.day, record.track, record.t, record.seed], ["daily", "bob", "2026-10-15", "hard", HEX, HEX]);
    assert.equal(parseGrantRecord(json.replace('"day":"2026-10-15"', '"day":"yesterday"')), null);
    assert.equal(parseGrantRecord(json.replace(`"k":"daily"`, `"deck":"precon_iron","k":"daily"`)), null, "a starter's field");
  });

  it("refuses to write a grant of no copies, too many, or for a malformed account", () => {
    assert.throws(() => grantRecord({ kind: GrantKind.STARTER, account: "alice", cards: [], deck: "precon_iron" }), /1\.\.60 copies/);
    assert.throws(() => grantRecord({ kind: GrantKind.STARTER, account: "alice", cards: Array.from({ length: MAX_GRANT_CARDS + 1 }, (_, i) => card(i + 1)), deck: "precon_iron" }), /grant/);
    assert.throws(() => grantRecord({ kind: GrantKind.STARTER, account: "Not An Account", cards: [card(1)], deck: "precon_iron" }), /grant/);
  });
});
