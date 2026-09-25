/**
 * STEEM transactions: byte-exact serialization (vectors produced by dsteem
 * 0.11.3 and steem-js 0.7.11, which agree), canonical signatures that
 * recover the signer's key, and the transaction provider: posting keys
 * only, broadcast, Resource Credits, publications read back as protocol
 * operations.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  SignerError,
  SteemBlockchainProvider,
  SteemPublicationReader,
  SteemRpcClient,
  SteemTransactionProvider,
  blockReference,
  customJsonOperation,
  decodeWif,
  encodePublicKey,
  fromBroadcastJson,
  isCanonicalSignature,
  publicKeyOf,
  recoverSignerKeys,
  serializeTransaction,
  transactionDigest,
  transactionId,
} from "../src/index.js";
import { fakeFetch, rawAccount } from "./fakes.js";

const WIF = "5JRaypasxMx1L97ZUX7YuC5Psb5EAbF821kkAGtBj7xCJFQcbLg";
const PUBLIC = "STM6aGPtxMUGnTPfKLSxdwCHbximSJxzrRjeQmwRW9BRCdrFotKLs";
const NODE = "https://node.example/";

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const seconds = (iso) => Date.parse(`${iso}Z`) / 1000;

const GAME_TX = Object.freeze({
  refBlockNum: 34294,
  refBlockPrefix: 3707022213,
  expiration: seconds("2026-09-24T10:01:00"),
  operations: [{ type: "custom_json", requiredAuths: [], requiredPostingAuths: ["m8tcg-b1"], id: "m8tcg_game", json: '{"r":[],"v":1}' }],
});

/** @param {string} signatureHex */
function recover(signatureHex, digest) {
  const bytes = Buffer.from(signatureHex, "hex");
  const signature = secp256k1.Signature.fromBytes(bytes.subarray(1), "compact").addRecoveryBit(bytes[0] - 31);
  return encodePublicKey(signature.recoverPublicKey(digest).toBytes(true));
}

describe("STEEM transaction serialization and signing", () => {
  it("serializes a custom_json transaction byte for byte like the reference libraries", () => {
    const bytes = serializeTransaction(GAME_TX);
    assert.equal(hex(bytes), "f68585abf4dcdcf4b46a01120001086d387463672d62310a6d387463675f67616d650e7b2272223a5b5d2c2276223a317d00");
    assert.equal(transactionId(bytes), "cec0b63f015f87423e1f88971a3c2612518ee935");
    const manifest = serializeTransaction({
      refBlockNum: 1,
      refBlockPrefix: 2,
      expiration: seconds("2030-01-01T00:00:00"),
      operations: [{ type: "custom_json", requiredAuths: ["root"], requiredPostingAuths: [], id: "m8tcg_manifest", json: '{"a":"é€😀"}' }],
    });
    assert.equal(hex(manifest), "01000200000080d8db7001120104726f6f74000e6d387463675f6d616e6966657374117b2261223a22c3a9e282acf09f9880227d00", "active authority and multi-byte UTF-8");
  });

  it("signs canonically, deterministically, and the signature recovers the signer's key", () => {
    const key = decodeWif(WIF);
    assert.equal(publicKeyOf(key), PUBLIC);
    const provider = new SteemTransactionProvider({ rpc: { call: async () => null }, chain: /** @type {any} */ ({}), keys: new Map([["m8tcg-b1", WIF]]) });
    const reference = { blockNum: 100_000, blockId: "000186a0dcdcf4b4aaaaaaaaaaaaaaaaaaaaaaaa", time: Date.parse("2026-09-24T10:00:00Z") };
    const signed = provider.signCustomJson({ reference, signer: "m8tcg-b1", id: "m8tcg_game", json: '{"r":[],"v":1}' });
    assert.equal(signed.expiration, reference.time + 60_000);
    const tx = /** @type {any} */ (signed.transaction);
    assert.deepEqual({ ...tx, signatures: undefined }, {
      ref_block_num: 100_000 & 0xffff,
      ref_block_prefix: 0xb4f4dcdc,
      expiration: "2026-09-24T10:01:00",
      operations: [["custom_json", { required_auths: [], required_posting_auths: ["m8tcg-b1"], id: "m8tcg_game", json: '{"r":[],"v":1}' }]],
      extensions: [],
      signatures: undefined,
    });
    const bytes = serializeTransaction({ ...blockReference(reference.blockNum, reference.blockId), expiration: seconds("2026-09-24T10:01:00"), operations: GAME_TX.operations });
    assert.equal(signed.txId, transactionId(bytes));
    const [signature] = tx.signatures;
    assert.match(signature, /^[0-9a-f]{130}$/);
    assert.ok(isCanonicalSignature(Buffer.from(signature, "hex").subarray(1)));
    assert.equal(recover(signature, transactionDigest(bytes)), PUBLIC);
    assert.equal(provider.signCustomJson({ reference, signer: "m8tcg-b1", id: "m8tcg_game", json: '{"r":[],"v":1}' }).transaction.signatures[0], signature, "deterministic");
    assert.throws(() => provider.signCustomJson({ reference, signer: "someone", id: "x", json: "{}" }), SignerError);

    const parsed = fromBroadcastJson(tx);
    assert.equal(hex(serializeTransaction(parsed.transaction)), hex(bytes), "the broadcast form reads back to the same bytes");
    assert.deepEqual(recoverSignerKeys(transactionDigest(bytes), [...parsed.signatures, "00".repeat(65)]), [PUBLIC, null]);
  });

  it("refuses what it does not publish", () => {
    const bad = (operation) => () => serializeTransaction({ ...GAME_TX, operations: [{ ...GAME_TX.operations[0], ...operation }] });
    assert.throws(bad({ type: "transfer" }), /only custom_json/);
    assert.throws(bad({ requiredPostingAuths: [] }), /at least one/);
    assert.throws(bad({ requiredPostingAuths: ["Bad"] }), /account names/);
    assert.throws(bad({ requiredPostingAuths: ["m8tcg-b1", "m8tcg-b1"] }), /duplicate/);
    assert.throws(bad({ id: "x".repeat(33) }), /custom_json id/);
    assert.throws(bad({ json: "x".repeat(8193) }), /8192 bytes/);
    assert.throws(() => serializeTransaction({ ...GAME_TX, refBlockNum: 70_000 }), /uint16/);
    assert.throws(() => serializeTransaction({ ...GAME_TX, operations: [] }), /at least one operation/);
    assert.throws(() => blockReference(1, "zz"), /40-hex/);
  });
});

describe("SteemTransactionProvider", () => {
  function provider(accountReply, handlers = {}) {
    const fake = fakeFetch({
      [NODE]: (request) => {
        const handler = handlers[request.method];
        if (handler !== undefined) {
          return handler(request);
        }
        return { reply: request.method === "condenser_api.get_accounts" ? accountReply : null };
      },
    });
    const rpc = new SteemRpcClient({ nodes: [NODE], fetch: fake.fetch });
    const chain = new SteemBlockchainProvider({ rpc });
    return { steem: new SteemTransactionProvider({ rpc, chain, keys: new Map([["m8tcg-b1", WIF]]) }), calls: fake.calls, chain };
  }

  it("accepts a posting key that signs alone, and refuses active, owner, foreign or weak keys", async () => {
    const other = publicKeyOf(new Uint8Array(32).fill(7));
    await provider([rawAccount("m8tcg-b1", [PUBLIC, other], { activeKeys: [other] })]).steem.verifySigners();
    const refused = async (reply, pattern) => assert.rejects(() => provider(reply).steem.verifySigners(), (error) => error instanceof SignerError && pattern.test(error.message));
    await refused([rawAccount("m8tcg-b1", [PUBLIC], { activeKeys: [PUBLIC] })], /posting key only/);
    await refused([rawAccount("m8tcg-b1", [PUBLIC], { activeKeys: [other], ownerKeys: [PUBLIC] })], /posting key only/);
    await refused([rawAccount("m8tcg-b1", [other], { activeKeys: [other] })], /not a posting key/);
    await refused([rawAccount("m8tcg-b1", [PUBLIC, other], { threshold: 2, activeKeys: [other] })], /sign alone/);
    await refused([], /does not exist/);
    assert.throws(() => new SteemTransactionProvider({ rpc: { call: async () => null }, chain: /** @type {any} */ ({}), keys: new Map([["m8tcg-b1", "not-a-wif"]]) }), SignerError);
  });

  it("references the head block, broadcasts, and reports Resource Credits with regeneration", async () => {
    const head = { head_block_number: 100_000, head_block_id: "000186a0dcdcf4b4aaaaaaaaaaaaaaaaaaaaaaaa", time: "2026-09-24T10:00:00", last_irreversible_block_num: 99_980 };
    const updated = seconds("2026-09-24T10:00:00") - 432_000 / 4;
    const { steem, calls } = provider([], {
      "condenser_api.get_dynamic_global_properties": () => ({ reply: head }),
      "condenser_api.broadcast_transaction": () => ({ reply: {} }),
      "rc_api.find_rc_accounts": () => ({ reply: { rc_accounts: [{ account: "m8tcg-b1", max_rc: "1000000000000", rc_manabar: { current_mana: "250000000000", last_update_time: updated } }] } }),
    });
    const reference = await steem.reference();
    assert.deepEqual(reference, { blockNum: 100_000, blockId: head.head_block_id, time: Date.parse("2026-09-24T10:00:00Z") });
    const signed = steem.signCustomJson({ reference, signer: "m8tcg-b1", id: "m8tcg_game", json: "{}" });
    await steem.broadcast(signed.transaction);
    assert.deepEqual(calls.at(-1).request.params, [signed.transaction]);
    const level = await steem.resourceLevel("m8tcg-b1", Date.parse("2026-09-24T10:00:00Z"));
    assert.deepEqual(level, { account: "m8tcg-b1", basisPoints: 5000 }, "25% + a quarter of the 5-day regeneration");
    assert.equal((await steem.resourceLevel("m8tcg-b1", Date.parse("2026-10-24T10:00:00Z"))).basisPoints, 10_000, "capped at the maximum");
  });
});

describe("SteemPublicationReader", () => {
  it("maps custom_json from history and blocks to protocol operations, and nothing else", async () => {
    const custom = { type: "custom_json", data: { required_auths: [], required_posting_auths: ["m8tcg-b1"], id: "m8tcg_game", json: '{"r":[],"v":1}' } };
    const chain = {
      getHead: async () => ({ headBlock: 10, irreversibleBlock: 9, time: 0 }),
      getLatestHistoryIndex: async () => 2,
      getAccountHistory: async () => [
        { index: 1, txId: "a".repeat(40), blockNum: 7, opIndex: 0, virtual: false, time: 0, operation: custom },
        { index: 2, txId: "b".repeat(40), blockNum: 8, opIndex: 0, virtual: false, time: 0, operation: { type: "vote", data: {} } },
      ],
      getBlock: async (blockNum) => (blockNum === 7 ? { blockNum, time: 0, transactions: [{ txId: "a".repeat(40), operations: [{ type: "transfer", data: {} }, custom] }] } : null),
    };
    const reader = new SteemPublicationReader({ chain });
    const expected = { network: "steem", txId: "a".repeat(40), blockNum: 7, opIndex: 0, id: "m8tcg_game", requiredAuths: [], requiredPostingAuths: ["m8tcg-b1"], json: '{"r":[],"v":1}' };
    assert.deepEqual(await reader.publications("m8tcg-b1", 0, 10), [{ index: 1, operation: expected }, { index: 2, operation: null }]);
    assert.deepEqual(await reader.blockOperations(7), [{ ...expected, opIndex: 1 }]);
    assert.equal(await reader.blockOperations(8), null);
    assert.equal(customJsonOperation({ txId: "c".repeat(40), blockNum: 1, opIndex: 0, operation: { type: "custom_json", data: { ...custom.data, required_auths: "root" } } }), null);
  });
});
