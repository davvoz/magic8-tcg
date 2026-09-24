/**
 * GameVerification bounds the cost of verifying from the chain: results are
 * cached (VALID for good, anything else for a minute) and only a few
 * verifications run at once.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GameVerification, VerificationBusyError } from "../../src/modules/chain/application/GameVerification.js";
import { ManualClock } from "../../src/kernel/time.js";

const GAME = "01j8x3r6h2qkq4w0v7m5a9c1dz";

function setup() {
  const clock = new ManualClock(Date.UTC(2026, 8, 24));
  const reads = { head: 0 };
  /** @type {(() => void)[]} */
  const gates = [];
  const reader = {
    network: "steem",
    head: async () => {
      reads.head += 1;
      await new Promise((resolve) => (reader.hold ? gates.push(resolve) : resolve()));
      return { headBlock: 10, irreversibleBlock: 5, time: 0 };
    },
    publications: async () => [],
    blockOperations: async () => [],
    hold: false,
  };
  const repository = { gameIndex: async (gameId) => (gameId === GAME ? [{ seq: 0, status: "IRREVERSIBLE", network: "steem", txId: "a".repeat(40), blockNum: 3 }] : []) };
  const verification = new GameVerification({ repository: /** @type {any} */ (repository), reader, rootAccount: "m8tcg", fetchContent: async () => null, clock, maxConcurrent: 1 });
  return { clock, reads, reader, gates, verification };
}

describe("GameVerification", () => {
  it("keeps a result that can still change for a minute only", async () => {
    const { clock, reads, verification } = setup();
    const first = await verification.verify(GAME);
    assert.equal(first.verdict, "INVALID", "no manifest: nothing authorised");
    await verification.verify(GAME);
    assert.equal(reads.head, 1, "served from the cache");
    clock.advance(61_000);
    await verification.verify(GAME);
    assert.equal(reads.head, 2, "read again after a minute");
    assert.equal(await verification.verify("0".repeat(26)), null, "unknown game");
  });

  it("refuses more concurrent verifications than allowed", async () => {
    const { reader, gates, verification } = setup();
    reader.hold = true;
    const running = verification.verify(GAME);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await assert.rejects(() => verification.verify(GAME), VerificationBusyError);
    gates.forEach((open) => open());
    reader.hold = false;
    assert.equal((await running).verdict, "INVALID");
  });
});
