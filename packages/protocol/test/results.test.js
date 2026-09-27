import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OperationId, gameResultRecord, parseGameResultRecord, utf8Length } from "../src/index.js";
import { GAME_ID, testHex } from "./fixtures/common.js";

const RESULT = Object.freeze({ gameId: GAME_ID, mode: "ranked", accounts: ["alice", "bob.cards"], seq: 131, head: testHex("head"), winner: "s1", reason: "concede" });

describe("game result records", () => {
  it("commit to the game's last event and outcome canonically, in a few hundred bytes", () => {
    assert.equal(OperationId.RESULT, "m8tcg_result");
    const json = gameResultRecord(RESULT);
    assert.equal(json, `{"a":["alice","bob.cards"],"g":"${GAME_ID}","h":"${RESULT.head}","m":"ranked","n":131,"r":"concede","v":1,"w":"s1"}`);
    assert.ok(utf8Length(json) < 250);
    assert.deepEqual([parseGameResultRecord(json).w, parseGameResultRecord(json).n], ["s1", 131]);
    assert.equal(parseGameResultRecord(gameResultRecord({ ...RESULT, winner: null, reason: "draw" })).w, null, "a draw names no winner");
  });

  it("read back only well-formed records, and refuse to write malformed ones", () => {
    const json = gameResultRecord(RESULT);
    const broken = [
      json.replace('"v":1', '"v":2'),
      json.replace('"bob.cards"', '"alice"'),
      json.replace('"w":"s1"', '"w":"s2"'),
      json.replace('"m":"ranked"', '"m":"wager"'),
      json.replace(`"h":"${RESULT.head}"`, '"h":"abc"'),
      json.replace('"n":131', '"n":-1'),
      json.replace('"r":"concede"', '"r":"Concede!"'),
      `${json} `,
      "{}",
    ];
    for (const text of broken) {
      assert.equal(parseGameResultRecord(text), null, text.slice(0, 80));
    }
    assert.throws(() => gameResultRecord({ ...RESULT, accounts: ["alice", "alice"] }), /two different accounts/);
    assert.throws(() => gameResultRecord({ ...RESULT, accounts: ["alice"] }), /two different accounts/);
  });
});
