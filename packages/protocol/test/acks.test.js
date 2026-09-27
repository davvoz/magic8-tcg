/**
 * Signed acks: the text the ack key signs, the shape a kept ack must have,
 * whether its signature is its key's — and the ack_keys manifests that name
 * the server's key. Signatures are faked here (the protocol takes
 * `recoverSigner` from outside); the real secp256k1 path runs in the server
 * tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AckKeyRegistry, BroadcasterRegistry, OperationId, ackKeysManifest, ackMessage, broadcastersManifest, isSignedByItsKey, parseSignedAck } from "../src/index.js";
import { BROADCASTER, GAME_ID, operation, testHex } from "./fixtures/common.js";

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

const rootManifest = (json, blockNum) => Object.freeze({ ...operation(json, { blockNum, txId: testHex(`manifest:${blockNum}`, 20), id: OperationId.MANIFEST, requiredAuths: [ROOT] }), requiredPostingAuths: [] });

describe("signed acks", () => {
  const signatures = fakeSignatures();
  const fields = { gameId: GAME_ID, commandId: "0000000a-0000-4000-8000-000000000001", seq: 4, head: testHex("head"), version: 7, at: 1_790_000_000_000, key: KEY };
  const ack = { ...fields, sig: signatures.sign(ackMessage(fields), KEY) };

  it("signs a canonical text naming the command, the event it produced and the key", () => {
    assert.equal(ackMessage(fields), `{"at":1790000000000,"cmd":"${fields.commandId}","g":"${GAME_ID}","head":"${fields.head}","key":"${KEY}","kind":"m8tcg_ack","seq":4,"v":1,"ver":7}`);
  });

  it("counts a signature only when it is the named key's, over exactly these fields", () => {
    assert.equal(isSignedByItsKey(ack, signatures.recoverSigner), true);
    assert.equal(isSignedByItsKey({ ...ack, seq: 5 }, signatures.recoverSigner), false, "another event");
    assert.equal(isSignedByItsKey({ ...ack, key: OTHER_KEY }, signatures.recoverSigner), false, "another key");
  });

  it("parses only well-formed acks", () => {
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
