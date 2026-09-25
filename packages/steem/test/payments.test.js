import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ChainDataError, Confirmation, SteemBlockchainProvider, SteemPublicationReader, SteemTransferPaymentProvider, formatSteemAsset, parseSteemAsset } from "../src/index.js";

const TX = "a1".repeat(20);
const OTHER_TX = "b2".repeat(20);
const TIME = "2026-09-24T10:00:03";

/** A fake JSON-RPC client that records calls and answers from a script. */
function fakeRpc(answer) {
  const calls = [];
  return { calls, rpc: { call: async (method, params) => (calls.push({ method, params }), answer(method, params)) } };
}

/** A condenser history entry. */
const entry = (index, op, { trx = TX, block = 100, opInTrx = 0, virtual = 0 } = {}) => [index, { trx_id: trx, block, trx_in_block: 0, op_in_trx: opInTrx, virtual_op: virtual, timestamp: TIME, op }];
const transferOp = (from, to, amount, memo) => ["transfer", { from, to, amount, memo }];

describe("STEEM assets", () => {
  it("parses only exact legacy asset strings", () => {
    assert.deepEqual(parseSteemAsset("12.500 STEEM"), { asset: "STEEM", amount: 12500 });
    assert.deepEqual(parseSteemAsset("0.001 SBD"), { asset: "SBD", amount: 1 });
    for (const bad of ["12.5 STEEM", "12.500 steem", "12.500 HIVE", "-1.000 STEEM", "1e3 STEEM", "01.000 STEEM", "12.500  STEEM", 12.5, null]) {
      assert.equal(parseSteemAsset(bad), null, String(bad));
    }
    assert.equal(formatSteemAsset(12500, "STEEM"), "12.500 STEEM");
    assert.equal(formatSteemAsset(1, "SBD"), "0.001 SBD");
    assert.throws(() => formatSteemAsset(1, "HIVE"), RangeError);
  });
});

describe("SteemBlockchainProvider history and blocks", () => {
  it("reads history forward from a cursor, oldest first", async () => {
    const { rpc, calls } = fakeRpc(() => [entry(5, transferOp("alice", "shop", "1.000 STEEM", "m")), entry(6, ["vote", { voter: "x" }])]);
    const chain = new SteemBlockchainProvider({ rpc });
    const entries = await chain.getAccountHistory("shop", 4, 100);
    assert.deepEqual(calls[0], { method: "condenser_api.get_account_history", params: ["shop", 104, 100] });
    assert.deepEqual(entries.map((item) => [item.index, item.operation.type]), [[5, "transfer"], [6, "vote"]]);
    assert.equal(entries[0].time, Date.parse(`${TIME}Z`));
    await chain.getAccountHistory("shop", -1, 100);
    assert.deepEqual(calls[1].params, ["shop", 100, 100], "start is never below limit");
  });

  it("drops entries outside the requested window and refuses malformed history", async () => {
    const window = new SteemBlockchainProvider({ rpc: fakeRpc(() => [entry(3, ["vote", {}]), entry(4, ["vote", {}]), entry(5, ["vote", {}])]).rpc });
    assert.deepEqual((await window.getAccountHistory("shop", 2, 2)).map((item) => item.index), [3, 4], "an entry past the window waits for the next page");
    await assert.rejects(window.getAccountHistory("shop", 3, 1), ChainDataError, "more entries than asked for");
    const unordered = new SteemBlockchainProvider({ rpc: fakeRpc(() => [entry(5, ["vote", {}]), entry(5, ["vote", {}])]).rpc });
    await assert.rejects(unordered.getAccountHistory("shop", 0, 10), ChainDataError);
    const badTx = new SteemBlockchainProvider({ rpc: fakeRpc(() => [entry(1, ["vote", {}], { trx: "xyz" })]).rpc });
    await assert.rejects(badTx.getAccountHistory("shop", 0, 10), ChainDataError);
    await assert.rejects(window.getAccountHistory("Not Valid", 0, 10), RangeError);
    const latest = new SteemBlockchainProvider({ rpc: fakeRpc(() => [entry(41, ["vote", {}])]).rpc });
    assert.equal(await latest.getLatestHistoryIndex("shop"), 41);
    assert.equal(await new SteemBlockchainProvider({ rpc: fakeRpc(() => []).rpc }).getLatestHistoryIndex("shop"), -1);
  });

  it("reads a block's transactions by id", async () => {
    const chain = new SteemBlockchainProvider({
      rpc: fakeRpc(() => ({ timestamp: TIME, transaction_ids: [TX], transactions: [{ operations: [transferOp("alice", "shop", "1.000 STEEM", "m")] }] })).rpc,
    });
    const block = await chain.getBlock(100);
    assert.equal(block.transactions[0].txId, TX);
    assert.equal(block.transactions[0].operations[0].data.amount, "1.000 STEEM");
    assert.equal(await new SteemBlockchainProvider({ rpc: fakeRpc(() => null).rpc }).getBlock(100), null);
    const mismatched = new SteemBlockchainProvider({ rpc: fakeRpc(() => ({ timestamp: TIME, transaction_ids: [TX, OTHER_TX], transactions: [{ operations: [] }] })).rpc });
    await assert.rejects(mismatched.getBlock(100), ChainDataError);
  });
});

/**
 * A fake node: its irreversible block and the blocks it knows.
 * @param {{ irreversible?: number, blocks?: Record<number, { txId: string, operations: any[] }[]>, fails?: boolean }} node
 */
function node({ irreversible = 1000, blocks = {}, fails = false } = {}) {
  return {
    getHead: async () => {
      if (fails) {
        throw new Error("node down");
      }
      return { headBlock: irreversible + 20, irreversibleBlock: irreversible, time: 0 };
    },
    getBlock: async (num) => (blocks[num] === undefined ? null : { blockNum: num, time: 0, transactions: blocks[num].map((tx) => ({ txId: tx.txId, operations: tx.operations.map(([type, data]) => ({ type, data })) })) }),
    getAccountHistory: async () => [],
    getLatestHistoryIndex: async () => -1,
  };
}

const PAID = Object.freeze({ network: "steem", txId: TX, opIndex: 0, blockNum: 100, time: 0, from: "alice", to: "shop", asset: "STEEM", amount: 1000, memo: "m8tcg-x" });
const blockWith = (op = transferOp("alice", "shop", "1.000 STEEM", "m8tcg-x")) => ({ 100: [{ txId: OTHER_TX, operations: [] }, { txId: TX, operations: [op] }] });

describe("SteemTransferPaymentProvider", () => {
  it("detects every transfer to the shop, in any asset, and advances the cursor", async () => {
    const history = {
      ...node(),
      getAccountHistory: async () =>
        new SteemBlockchainProvider({
          rpc: fakeRpc(() => [
            entry(10, transferOp("alice", "shop", "1.000 STEEM", "m8tcg-a")),
            entry(11, transferOp("shop", "bob", "2.000 STEEM", "refund")),
            entry(12, transferOp("carol", "shop", "0.500 SBD", "")),
            entry(13, ["vote", { voter: "dave" }]),
            entry(14, transferOp("eve", "shop", "1.5 STEEM", "malformed amount")),
            entry(15, ["fill_order", { owner: "shop" }], { virtual: 1, trx: "0".repeat(40) }),
          ]).rpc,
        }).getAccountHistory("shop", 9, 10),
    };
    const provider = new SteemTransferPaymentProvider({ history, verifiers: [node(), node()] });
    const { transfers, cursor } = await provider.incomingTransfers("shop", 9, 10);
    assert.equal(cursor, 15);
    assert.deepEqual(transfers.map((transfer) => [transfer.from, transfer.asset, transfer.amount, transfer.memo]), [["alice", "STEEM", 1000, "m8tcg-a"], ["carol", "SBD", 500, ""]]);
    assert.equal(transfers[0].txId, TX);
    const empty = new SteemTransferPaymentProvider({ history: node(), verifiers: [node(), node()] });
    assert.deepEqual(await empty.incomingTransfers("shop", 42, 10), { transfers: [], cursor: 42 }, "no news keeps the cursor");
  });

  it("confirms only when two nodes see the same transfer below their irreversible block", async () => {
    const confirmed = new SteemTransferPaymentProvider({ history: node(), verifiers: [node({ blocks: blockWith() }), node({ blocks: blockWith() })] });
    assert.equal(await confirmed.confirm(PAID), Confirmation.IRREVERSIBLE);

    const tooEarly = new SteemTransferPaymentProvider({ history: node(), verifiers: [node({ irreversible: 99, blocks: blockWith() }), node({ blocks: blockWith() })] });
    assert.equal(await tooEarly.confirm(PAID), Confirmation.PENDING);

    const oneNodeDown = new SteemTransferPaymentProvider({ history: node(), verifiers: [node({ fails: true }), node({ blocks: blockWith() })] });
    assert.equal(await oneNodeDown.confirm(PAID), Confirmation.PENDING, "one confirmation is not a quorum");

    const threeNodesOneDown = new SteemTransferPaymentProvider({ history: node(), verifiers: [node({ blocks: blockWith() }), node({ fails: true }), node({ blocks: blockWith() })] });
    assert.equal(await threeNodesOneDown.confirm(PAID), Confirmation.IRREVERSIBLE);
  });

  it("does not trust a lying node, and reports a transfer that vanished", async () => {
    const liar = node({ blocks: blockWith(transferOp("alice", "shop", "100.000 STEEM", "m8tcg-x")) });
    const disagree = new SteemTransferPaymentProvider({ history: node(), verifiers: [node({ blocks: blockWith() }), liar] });
    assert.equal(await disagree.confirm(PAID), Confirmation.PENDING, "nodes disagree: wait");

    const forked = new SteemTransferPaymentProvider({ history: node(), verifiers: [node({ blocks: { 100: [] } }), node({ blocks: { 100: [] } })] });
    assert.equal(await forked.confirm(PAID), Confirmation.MISSING, "not in the irreversible block on any node");

    const substituted = new SteemTransferPaymentProvider({ history: node(), verifiers: [node({ blocks: blockWith(transferOp("alice", "shop", "0.001 STEEM", "m8tcg-x")) }), node({ blocks: blockWith(transferOp("alice", "shop", "0.001 STEEM", "m8tcg-x")) })] });
    assert.equal(await substituted.confirm(PAID), Confirmation.MISSING, "the chain has a different transfer at that place");
  });

  it("refuses to run without two verifier nodes", () => {
    assert.throws(() => new SteemTransferPaymentProvider({ history: node(), verifiers: [node()] }), RangeError);
    assert.throws(() => new SteemTransferPaymentProvider({ history: node(), verifiers: [node(), node()], quorum: 1 }), RangeError);
  });
});

describe("posting key history", () => {
  const authority = (keys, threshold = 1) => ({ weight_threshold: threshold, account_auths: [], key_auths: keys.map((key) => [key, 1]) });
  const KEY_A = "STM6LLegbAgLAy28EHrffBVuANFWcFgmqRMW13wBmTExqFE9SCkg4";
  const KEY_B = "STM8ZSw7FkF7dKVnQb4RLQ7QKy9cSBHrDTkxeWtxTU3ceFSfWfE8m";

  it("reads key changes with the node's operation filter, in one call, from the account's creation on", async () => {
    const { rpc, calls } = fakeRpc(() => [
      entry(0, ["account_create", { creator: "steem", new_account_name: "alice", owner: authority([KEY_A]), active: authority([KEY_A]), posting: authority([KEY_A]) }], { block: 10 }),
      entry(1, ["account_update", { account: "alice", posting: authority([KEY_B]) }], { block: 500 }),
      entry(2, ["account_update", { account: "alice", memo_key: KEY_A }], { block: 600 }),
      entry(3, ["account_create", { creator: "alice", new_account_name: "bob", posting: authority([KEY_B]) }], { block: 700 }),
      entry(4, ["account_update", { account: "alice", posting: authority([KEY_A, KEY_B], 2) }], { block: 800 }),
    ]);
    const reader = new SteemPublicationReader({ chain: new SteemBlockchainProvider({ rpc }) });
    const history = await reader.postingKeyHistory("alice");
    assert.deepEqual(calls[0].params, ["alice", -1, 1000, 2 ** 9 + 2 ** 10 + 2 ** 23 + 2 ** 41, 0]);
    assert.deepEqual(history, {
      complete: true,
      changes: [
        { blockNum: 10, keys: [KEY_A], created: true },
        { blockNum: 500, keys: [KEY_B], created: false },
        { blockNum: 800, keys: [], created: false },
      ],
    }, "a memo-only update and another account's creation change nothing; a multi-key authority has no key that suffices alone");
  });

  it("says it cannot tell when the node refuses the filter", async () => {
    const failing = { call: async () => { throw new Error("unknown parameter"); } };
    assert.equal(await new SteemPublicationReader({ chain: new SteemBlockchainProvider({ rpc: failing }) }).postingKeyHistory("alice"), null);
    assert.equal(await new SteemPublicationReader({ chain: {} }).postingKeyHistory("alice"), null);
  });
});

