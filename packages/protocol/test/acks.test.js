/**
 * Signed acks against the published game: a kept ack proves what the
 * server accepted, so the chain either agrees with it (CONSISTENT), shows
 * another game (DIVERGENT), or ends without the move (OMITTED). Only keys
 * the root authorised when the game was created count. Signatures are
 * faked here (the protocol takes `recoverSigner` from outside); the real
 * secp256k1 path runs in the server tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AckKeyRegistry, AckStatus, BroadcasterRegistry, OperationId, ackKeysManifest, ackMessage, broadcastersManifest, parseSignedAck, verifyGameOnChain } from "../src/index.js";
import { BROADCASTER, GAME_ID, operation, playReferenceGame, testHex } from "./fixtures/referenceGame.js";

const ROOT = "m8tcg";
const KEY = "STM6LLegbAgLAy28EHrffBVuANFWcFgmqRMW13wBmTExqFE9SCkg4";
const OTHER_KEY = "STM8ZSw7FkF7dKVnQb4RLQ7QKy9cSBHrDTkxeWtxTU3ceFSfWfE8m";

/** A stand-in for secp256k1: remembers who "signed" what. */
function fakeSignatures() {
  const signed = new Map();
  return {
    sign: (message, key) => {
      const sig = `${testHex(`${message}|${key}`)}${testHex(`${key}|${message}`)}00`;
      signed.set(`${sig}|${message}`, key);
      return sig;
    },
    recoverSigner: (message, sig) => signed.get(`${sig}|${message}`) ?? null,
  };
}

function chainOf(operations, irreversibleBlock = 5000) {
  const byAccount = new Map();
  for (const op of operations) {
    const account = op.requiredAuths[0] ?? op.requiredPostingAuths[0];
    byAccount.set(account, [...(byAccount.get(account) ?? []), op]);
  }
  return {
    head: async () => ({ headBlock: irreversibleBlock + 20, irreversibleBlock, time: 0 }),
    publications: async (account, after, limit) => (byAccount.get(account) ?? []).map((op, index) => ({ index, operation: op })).filter((entry) => entry.index > after).slice(0, limit),
    blockOperations: async (blockNum) => operations.filter((op) => op.blockNum === blockNum),
  };
}

const rootManifest = (json, blockNum) => Object.freeze({ ...operation(json, { blockNum, txId: testHex(`manifest:${blockNum}`, 20), id: OperationId.MANIFEST, requiredAuths: [ROOT] }), requiredPostingAuths: [] });

describe("signed acks", () => {
  const game = playReferenceGame({ label: "acks" });
  const signatures = fakeSignatures();
  const ackFor = (chained, { key = KEY, head = chained.head, gameId = GAME_ID } = {}) => {
    const fields = { gameId, commandId: "0000000a-0000-4000-8000-000000000001", seq: chained.event.i, head, version: 7, at: 1_790_000_000_000, key };
    return { ...fields, sig: signatures.sign(ackMessage(fields), key) };
  };
  const move = game.events.find((chained) => chained.event.k === "MOVE");
  const verify = (acks, { manifests = [rootManifest(ackKeysManifest({ keys: [KEY], fromBlock: 0 }), 900)], operations = game.operations } = {}) =>
    verifyGameOnChain({ gameId: GAME_ID, reader: chainOf([rootManifest(broadcastersManifest({ accounts: [BROADCASTER], fromBlock: 0 }), 800), ...manifests, ...operations]), rootAccount: ROOT, blocks: operations.map((op) => op.blockNum), fetchContent: async () => null, acks, recoverSigner: signatures.recoverSigner });
  const statuses = async (acks, options) => (await verify(acks, options)).acks.map((checked) => checked.status);

  it("agrees with the chain for what the server acknowledged and published", async () => {
    const last = game.events.at(-1);
    assert.deepEqual(await statuses([ackFor(move), ackFor(last)]), [AckStatus.CONSISTENT, AckStatus.CONSISTENT]);
  });

  it("proves a published game that differs from an ack, or that leaves out an acknowledged move", async () => {
    assert.deepEqual(await statuses([ackFor(move, { head: "ee".repeat(32) })]), [AckStatus.DIVERGENT]);
    const beyond = { event: { ...game.events.at(-1).event, i: game.events.length + 3 }, head: "dd".repeat(32) };
    assert.deepEqual(await statuses([ackFor(beyond)]), [AckStatus.OMITTED], "the game ended on chain without it");
    assert.deepEqual(await statuses([ackFor(beyond)], { operations: game.operations.slice(0, 1) }), [AckStatus.NOT_PUBLISHED], "the game is not all on chain yet");
  });

  it("counts only genuine signatures by a key the root authorised when the game was created", async () => {
    const tampered = { ...ackFor(move), version: 8 };
    assert.deepEqual(await statuses([tampered]), [AckStatus.BAD_SIGNATURE]);
    assert.deepEqual(await statuses([ackFor(move, { key: OTHER_KEY })]), [AckStatus.UNTRUSTED_KEY]);
    const late = [rootManifest(ackKeysManifest({ keys: [KEY], fromBlock: 0 }), 4000)];
    assert.deepEqual(await statuses([ackFor(move)], { manifests: late }), [AckStatus.UNTRUSTED_KEY], "a key named after the game was created proves nothing about it");
    const revoked = [rootManifest(ackKeysManifest({ keys: [KEY], fromBlock: 0 }), 900), rootManifest(ackKeysManifest({ keys: [], fromBlock: 0 }), 950)];
    assert.deepEqual(await statuses([ackFor(move)], { manifests: revoked }), [AckStatus.UNTRUSTED_KEY]);
    assert.deepEqual(await statuses([ackFor(move, { gameId: "01j8x3r6h2qkq4w0v7m5a9c1e0" }), { nonsense: true }]), [AckStatus.INVALID, AckStatus.INVALID]);
  });

  it("needs a way to recover signers only when there are acks to check", async () => {
    const reader = chainOf(game.operations);
    const base = { gameId: GAME_ID, reader, rootAccount: ROOT, blocks: game.operations.map((op) => op.blockNum), fetchContent: async () => null };
    assert.deepEqual((await verifyGameOnChain(base)).acks, []);
    await assert.rejects(verifyGameOnChain({ ...base, acks: [ackFor(move)] }), /recoverSigner/);
  });

  it("parses only well-formed acks", () => {
    const ack = ackFor(move);
    assert.deepEqual(parseSignedAck(ack), ack);
    for (const broken of [{ ...ack, extra: 1 }, { ...ack, seq: -1 }, { ...ack, sig: "zz" }, { ...ack, key: "STM<script>" }, { ...ack, commandId: "x" }, null, []]) {
      assert.equal(parseSignedAck(broken), null, JSON.stringify(broken));
    }
  });
});

describe("ack-keys manifests", () => {
  it("authorise keys like broadcaster manifests authorise accounts, and neither kind counts for the other", () => {
    const operations = [rootManifest(ackKeysManifest({ keys: [KEY], fromBlock: 100 }), 50), rootManifest(broadcastersManifest({ accounts: [BROADCASTER], fromBlock: 0 }), 60)];
    const acks = AckKeyRegistry.fromOperations(operations, ROOT);
    const broadcasters = BroadcasterRegistry.fromOperations(operations, ROOT);
    assert.deepEqual([acks.rejected, broadcasters.rejected], [0, 0]);
    assert.deepEqual([acks.registry.isAuthorized(KEY, 99), acks.registry.isAuthorized(KEY, 100), acks.registry.isAuthorized(BROADCASTER, 100)], [false, true, false]);
    assert.deepEqual(broadcasters.registry.accounts(), [BROADCASTER]);
    assert.equal(ackKeysManifest({ keys: [OTHER_KEY, KEY], fromBlock: 3 }), `{"from_block":3,"keys":["${KEY}","${OTHER_KEY}"],"kind":"ack_keys","v":1}`);
    assert.throws(() => ackKeysManifest({ keys: ["alice"], fromBlock: 0 }), /STEEM public keys/);
    assert.throws(() => ackKeysManifest({ keys: [KEY, KEY], fromBlock: 0 }), /distinct/);
  });
});
