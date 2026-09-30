import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ChainDataError, Confirmation, SteemBlockchainProvider, SteemTransferPaymentProvider, formatSteemAsset, parseSteemAsset } from "../src/index.js";
import { HISTORY_OVERLAP } from "../src/providers/SteemTransferPaymentProvider.js";

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
/** The end of the shop's history as api.moecki.online numbers it (one lower than api.steemit.com). */
const MOECKI_HISTORY = Object.freeze([
  entry(318, transferOp("alice", "shop", "29.000 STEEM", "m8tcg-older"), { block: 110026315 }),
  entry(319, ["custom_json", { id: "m8tcg_receipt" }], { trx: OTHER_TX, block: 110026338 }),
  entry(320, transferOp("alice", "shop", "3.500 STEEM", "m8tcg-new"), { block: 110035670 }),
]);

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
    getLatestHistoryEntry: async () => null,
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
    const { transfers, cursor } = await provider.incomingTransfers("shop", 9, 100);
    assert.equal(cursor, 15);
    assert.deepEqual(transfers.map((transfer) => [transfer.from, transfer.asset, transfer.amount, transfer.memo]), [["alice", "STEEM", 1000, "m8tcg-a"], ["carol", "SBD", 500, ""]]);
    assert.equal(transfers[0].txId, TX);
    const empty = new SteemTransferPaymentProvider({ history: node(), verifiers: [node(), node()] });
    assert.deepEqual(await empty.incomingTransfers("shop", 42, 100, 7), { transfers: [], cursor: 42, sinceBlock: 7 }, "no news keeps the position");
  });

  it("re-reads the entries before the cursor, so a node that numbers the history lower cannot hide a transfer", async () => {
    // 2026-09-30: api.steemit.com lists one old operation twice, api.moecki.online once. The cursor (320, block 110026338)
    // was saved from api.steemit.com, where 320 is the shop's last receipt; on api.moecki.online 320 is the next payment.
    const { calls, rpc } = fakeRpc((method, [, start, limit]) => MOECKI_HISTORY.filter(([index]) => index >= start - limit && index <= start));
    const provider = new SteemTransferPaymentProvider({ history: new SteemBlockchainProvider({ rpc }), verifiers: [node(), node()] });
    const page = await provider.incomingTransfers("shop", 320, 100, 110026338);
    assert.deepEqual(page.transfers.map((transfer) => transfer.memo), ["m8tcg-new"], "the older transfer, in an earlier block, is not read again");
    assert.equal(page.cursor, 320, "the cursor never moves back");
    assert.equal(page.sinceBlock, 110035670);
    assert.ok(calls[0].params[1] - calls[0].params[2] <= 320 - HISTORY_OVERLAP, "the read starts before the cursor");
    const unknownBlock = await provider.incomingTransfers("shop", 320, 100, null);
    assert.deepEqual(unknownBlock.transfers.map((transfer) => transfer.memo), ["m8tcg-older", "m8tcg-new"], "without a block the whole overlap comes back");
    await assert.rejects(provider.incomingTransfers("shop", 320, HISTORY_OVERLAP), RangeError, "a page must be longer than the overlap");
  });

  it("starts a new watcher after everything already in the history, whichever node answers", async () => {
    // The position comes from a node that numbers the payment 321; the reads come from one that numbers it 320.
    const steemitLatest = entry(321, transferOp("alice", "shop", "3.500 STEEM", "m8tcg-new"), { block: 110035670 });
    const position = await new SteemTransferPaymentProvider({ history: new SteemBlockchainProvider({ rpc: fakeRpc(() => [steemitLatest]).rpc }), verifiers: [node(), node()] }).latestPosition("shop");
    assert.deepEqual(position, { cursor: 321, sinceBlock: 110035671 });
    const later = [...MOECKI_HISTORY, entry(321, transferOp("bob", "shop", "1.000 STEEM", "m8tcg-later"), { block: 110040000 })];
    const moecki = new SteemTransferPaymentProvider({
      history: new SteemBlockchainProvider({ rpc: fakeRpc((method, [, start, limit]) => later.filter(([index]) => index >= start - limit && index <= start)).rpc }),
      verifiers: [node(), node()],
    });
    const page = await moecki.incomingTransfers("shop", position.cursor, 100, position.sinceBlock);
    assert.deepEqual(page.transfers.map((transfer) => transfer.memo), ["m8tcg-later"], "only what reached the chain after the watcher started");
    const empty = new SteemTransferPaymentProvider({ history: node(), verifiers: [node(), node()] });
    assert.deepEqual(await empty.latestPosition("shop"), { cursor: -1, sinceBlock: 0 });
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
