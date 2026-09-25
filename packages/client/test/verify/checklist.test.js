/**
 * The verifier page's checklist, from verification results shaped like
 * verifyGameOnChain's.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ackCheck, checklist, signatureChecks, verdictBanner } from "../../verify/checklist.js";

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

  it("shows the acks kept while playing, and a contradiction as proof", () => {
    const agreed = [{ status: "CONSISTENT", seq: 5 }, { status: "CONSISTENT", seq: 7 }, { status: "NOT_PUBLISHED", seq: 9 }];
    const checks = checklist(result({ acks: agreed }), { root: "luciojolly", indexed: true });
    assert.deepEqual(checks.at(-1), { label: "Your signed acks", ok: true, detail: "2 of 3 agree with the chain; 1 not published yet" });
    assert.equal(checklist(result({ acks: [] }), { root: "luciojolly", indexed: true }).length, 6, "no acks, no check");
    assert.equal(ackCheck([{ status: "CONSISTENT", seq: 5 }, { status: "BAD_SIGNATURE", seq: 7 }]).ok, null, "a worthless ack is not a proof either way");
    const contradicted = [...agreed, { status: "DIVERGENT", seq: 11 }];
    assert.match(ackCheck(contradicted).detail, /PROOF: .* event\(s\) 11 \(divergent\)/);
    assert.equal(verdictBanner("VALID", contradicted).tone, "bad");
    assert.equal(verdictBanner("VALID", agreed).tone, "good");
  });

  it("shows signed moves and who authorised the session keys, for v2 games", () => {
    assert.deepEqual(signatureChecks({ signatures: { status: "NOT_REQUIRED" }, sessions: [] }), [], "v1: nothing to show");
    const good = signatureChecks({ signatures: { status: "VALID", message: null }, sessions: [{ account: "alice", status: "AUTHORIZED" }, { account: "bob", status: "AUTHORIZED" }] });
    assert.deepEqual(good.map((check) => [check.label, check.ok]), [["Signed moves", true], ["Session keys", true]]);
    assert.equal(good[1].detail, "@alice authorized, @bob authorized");
    const rotated = signatureChecks({ signatures: { status: "VALID", message: null }, sessions: [{ account: "alice", status: "KEY_NOT_CURRENT" }] });
    assert.equal(rotated[1].ok, null, "a key rotated since proves nothing either way");
    const bad = signatureChecks({ signatures: { status: "BAD_MOVE_SIGNATURE", message: "move 9 is not signed by s1's session key" }, sessions: [{ account: "bob", status: "FORGED" }] });
    assert.deepEqual(bad.map((check) => check.ok), [false, false]);
    assert.equal(checklist(result({ signatures: { status: "VALID", message: null }, sessions: [] }), { root: "luciojolly", indexed: true })[4].label, "Signed moves");
  });
});
