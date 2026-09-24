/**
 * verifyGameOnChain with an in-memory chain reader: the root's manifests
 * decide who may sign, only irreversible blocks count, an index can only
 * omit (never add) operations, scanning needs no index, and content is
 * accepted only when it hashes to what the game declared. The full VALID
 * path with real content runs in the server tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ENGINE_VERSION } from "@magic8/engine/version.js";
import { OperationId, Verdict, broadcastersManifest, replayContentOf, sealContent, verifyGameOnChain } from "../src/index.js";
import { BROADCASTER, CONTENT_HASH, GAME_ID, operation, playReferenceGame, testHex } from "./fixtures/referenceGame.js";

const ROOT = "m8tcg";

/** A chain whose history and blocks hold the given operations. */
function chainOf(operations, { irreversibleBlock = 5000 } = {}) {
  const byAccount = new Map();
  for (const op of operations) {
    const account = op.requiredAuths[0] ?? op.requiredPostingAuths[0];
    byAccount.set(account, [...(byAccount.get(account) ?? []), op]);
  }
  const reads = [];
  return {
    reads,
    head: async () => ({ headBlock: irreversibleBlock + 20, irreversibleBlock, time: 0 }),
    publications: async (account, after, limit) => {
      reads.push(account);
      return (byAccount.get(account) ?? []).map((op, index) => ({ index, operation: op })).filter((entry) => entry.index > after).slice(0, limit);
    },
    blockOperations: async (blockNum) => {
      const found = operations.filter((op) => op.blockNum === blockNum);
      return found.length === 0 && blockNum > 4000 ? null : found;
    },
  };
}

const manifest = (accounts, blockNum, fromBlock = 0) =>
  Object.freeze({ ...operation(broadcastersManifest({ accounts, fromBlock }), { blockNum, txId: testHex(`manifest:${blockNum}`, 20), id: OperationId.MANIFEST, requiredAuths: [ROOT] }), requiredPostingAuths: [] });
const noContent = async () => null;

describe("verifyGameOnChain", () => {
  const game = playReferenceGame({ label: "chain-verifier" });
  const blocks = game.operations.map((op) => op.blockNum);

  it("collects the game from an index of blocks, trusting only broadcasters the root authorised", async () => {
    const withoutManifest = await verifyGameOnChain({ gameId: GAME_ID, reader: chainOf(game.operations), rootAccount: ROOT, blocks, fetchContent: noContent });
    assert.equal(withoutManifest.verdict, Verdict.INVALID);
    assert.equal(withoutManifest.rejected.length, game.operations.length, "no manifest: every operation is from an unauthorised signer");

    const reader = chainOf([manifest([BROADCASTER], 900), ...game.operations]);
    const result = await verifyGameOnChain({ gameId: GAME_ID, reader, rootAccount: ROOT, blocks, fetchContent: noContent });
    assert.deepEqual(result.broadcasters, [BROADCASTER]);
    assert.equal(result.rejected.length, 0);
    assert.equal(result.history.status, "COMPLETE");
    assert.deepEqual(result.content.declared, { hash: CONTENT_HASH, engineVersion: ENGINE_VERSION });
    assert.equal(result.content.verified, false, "the fixture's content hash is fake: nothing can match it");
    assert.equal(result.replay.status, "UNKNOWN_CONTENT");
  });

  it("ignores manifests signed without the root's active authority, and forged game operations", async () => {
    const posting = operation(broadcastersManifest({ accounts: ["mallory"], fromBlock: 0 }), { blockNum: 901, txId: testHex("posting", 20), signer: ROOT, id: OperationId.MANIFEST });
    const forged = operation(game.envelopes[0].json, { blockNum: 1500, txId: testHex("forged", 20), signer: "mallory" });
    const reader = chainOf([manifest([BROADCASTER], 900), posting, ...game.operations, forged]);
    const result = await verifyGameOnChain({ gameId: GAME_ID, reader, rootAccount: ROOT, blocks: [...blocks, 1500], fetchContent: noContent });
    assert.deepEqual(result.broadcasters, [BROADCASTER]);
    assert.deepEqual(result.rejected.map((rejection) => rejection.reason), ["UNAUTHORIZED_SIGNER"]);
  });

  it("reads only irreversible blocks, and reports an index that omits one as a gap", async () => {
    const reader = chainOf([manifest([BROADCASTER], 900), ...game.operations], { irreversibleBlock: blocks[1] });
    const early = await verifyGameOnChain({ gameId: GAME_ID, reader, rootAccount: ROOT, blocks, fetchContent: noContent });
    assert.deepEqual(early.pendingBlocks, blocks.slice(2));
    assert.equal(early.verdict, Verdict.IN_PROGRESS);

    const gap = await verifyGameOnChain({ gameId: GAME_ID, reader: chainOf([manifest([BROADCASTER], 900), ...game.operations]), rootAccount: ROOT, blocks: blocks.filter((_, index) => index !== 1), fetchContent: noContent });
    assert.equal(gap.history.status, "INCOMPLETE");
    assert.equal(gap.verdict, Verdict.INVALID);
  });

  it("scans the authorised broadcasters' histories when no index is given", async () => {
    const reader = chainOf([manifest([BROADCASTER], 900), ...game.operations]);
    const result = await verifyGameOnChain({ gameId: GAME_ID, reader, rootAccount: ROOT, fetchContent: noContent });
    assert.equal(result.history.status, "COMPLETE");
    assert.ok(reader.reads.includes(BROADCASTER));
    assert.equal(result.complete, true);
  });

  it("accepts content only when it hashes to the declared hash", () => {
    const { hash, payload } = sealContent({ cardSets: [], preconDecks: [], gameRules: {}, deckRules: {} });
    assert.equal(replayContentOf(payload, "00".repeat(32)), null, "wrong hash");
    assert.equal(replayContentOf(`${payload} `, hash), null, "not the exact payload");
    assert.equal(replayContentOf(payload, hash), null, "hashes right but is not valid content");
  });
});
