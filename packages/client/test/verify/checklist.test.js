/**
 * The verifier page's checklist, from verification results shaped like
 * verifyGameOnChain's.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checklist, verdictBanner } from "../../verify/checklist.js";

function result(overrides = {}) {
  return {
    verdict: "VALID",
    broadcasters: ["m8tcg-b1"],
    rejected: [],
    pendingBlocks: [],
    history: { status: "COMPLETE", problem: null, records: [{}, {}, {}], events: new Array(40).fill({}) },
    content: { declared: { hash: "ab".repeat(32), engineVersion: "0.1.0" }, verified: true, localEngine: "0.1.0" },
    replay: { status: "VALID", message: null, outcome: { winner: "s1", reason: "concede" } },
    ...overrides,
  };
}

describe("verifier checklist", () => {
  it("lists every check of a valid game", () => {
    const checks = checklist(result(), { root: "luciojolly", indexed: true });
    assert.deepEqual(checks.map((check) => [check.label, check.ok]), [
      ["Trust anchor", true],
      ["Records found", true],
      ["Forged operations ignored", true],
      ["Hash chain and lifecycle", true],
      ["Content", true],
      ["Reveals and replay", true],
    ]);
    assert.equal(checks[0].detail, "@luciojolly authorises @m8tcg-b1");
    assert.equal(checks[1].detail, "3 record(s) in the indexed blocks");
    assert.match(checks[5].detail, /winner s1 \(concede\)/);
    assert.equal(verdictBanner("VALID").tone, "good");
  });

  it("points at what failed", () => {
    const tampered = result({
      verdict: "INVALID",
      broadcasters: [],
      rejected: [{ txId: "a", reason: "UNAUTHORIZED_SIGNER", message: "" }, { txId: "b", reason: "UNAUTHORIZED_SIGNER", message: "" }],
      pendingBlocks: [7],
      history: { status: "TAMPERED", problem: { message: "record 2 does not chain" }, records: [], events: [] },
      content: { declared: null, verified: false, localEngine: "0.1.0" },
      replay: null,
    });
    const checks = checklist(tampered, { root: "m8tcg", indexed: false });
    assert.equal(checks.length, 5, "no replay without a complete history");
    assert.deepEqual(checks.map((check) => check.ok), [false, false, true, false, null]);
    assert.equal(checks[0].detail, "@m8tcg authorises none");
    assert.equal(checks[1].detail, "0 record(s) in the broadcasters' histories; 1 block(s) not irreversible yet");
    assert.equal(checks[2].detail, "2 ignored (UNAUTHORIZED_SIGNER)");
    assert.equal(checks[3].detail, "record 2 does not chain");
    assert.deepEqual([verdictBanner("INVALID").tone, verdictBanner("IN_PROGRESS").tone], ["bad", "wait"]);
  });
});
