/**
 * Provenance of a copy from the chain alone: minted by one receipt, then
 * moved by trades, each given by the owner of the moment. Operations not
 * signed by an authorised broadcaster count for nothing.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OperationId, ProvenanceVerdict, broadcastersManifest, buildReceipts, canonicalize, traceCopy, tradeRecord, verifyCopyOnChain } from "../src/index.js";
import { BROADCASTER, operation, testHex } from "./fixtures/referenceGame.js";

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const COPY = uuid(1);
const card = (id = COPY, overrides = {}) => ({ id, definitionId: "ember_imp", serial: 7, finish: "foil", ...overrides });
let block = 1000;
const op = (id, json, signer = BROADCASTER) => operation(json, { blockNum: (block += 1), txId: testHex(`op:${block}`, 20), signer, id });
const receipt = (orderId, account, cards) => op(OperationId.RECEIPT, buildReceipts({ orderId, account, network: "steem", txId: testHex(orderId, 20), items: [{ productId: "single", quantity: cards.length }], packs: [], cards })[0]);
const trade = ({ n, from, to, gives, takes = [], signer }) => op(OperationId.TRADE, tradeRecord({ tradeId: uuid(100 + n), proposer: { account: from, cards: gives }, counterparty: { account: to, cards: takes } }), signer);
const trace = (operations) => traceCopy({ copyId: COPY, operations, isAuthorizedBroadcaster: (account) => account === BROADCASTER });

describe("copy provenance", () => {
  it("follows a copy from its receipt through every trade to its owner", () => {
    const result = trace([receipt(uuid(50), "alice", [card(), card(uuid(2))]), trade({ n: 1, from: "alice", to: "bob", gives: [card()] }), trade({ n: 2, from: "carol", to: "bob", gives: [card(uuid(3), { definitionId: "iron_watcher" })], takes: [card()] }), trade({ n: 3, from: "dave", to: "erin", gives: [card(uuid(4))] })]);
    assert.equal(result.verdict, ProvenanceVerdict.VALID, result.problem);
    assert.deepEqual(result.copy, { id: COPY, definitionId: "ember_imp", serial: 7, finish: "foil" });
    assert.deepEqual([result.minted.account, result.minted.order], ["alice", uuid(50)]);
    assert.deepEqual(result.transfers.map((transfer) => [transfer.from, transfer.to]), [["alice", "bob"], ["bob", "carol"]], "bob gave it back as the counterparty of trade 2");
    assert.equal(result.owner, "carol");
  });

  it("knows nothing of a copy no receipt names, and ignores what an unauthorised account signed", () => {
    assert.equal(trace([trade({ n: 4, from: "alice", to: "bob", gives: [card()] })]).verdict, ProvenanceVerdict.UNKNOWN);
    const forged = trace([receipt(uuid(51), "alice", [card()]), trade({ n: 5, from: "alice", to: "mallory", gives: [card()], signer: "mallory" })]);
    assert.deepEqual([forged.verdict, forged.owner], [ProvenanceVerdict.VALID, "alice"]);
  });

  it("rejects a copy given by someone who did not own it, minted twice, or traded as another printing", () => {
    const thief = trace([receipt(uuid(52), "alice", [card()]), trade({ n: 6, from: "bob", to: "carol", gives: [card()] })]);
    assert.deepEqual([thief.verdict, thief.problem], [ProvenanceVerdict.INVALID, `trade ${uuid(106)} has @bob give a copy @alice owned`]);
    assert.equal(trace([receipt(uuid(53), "alice", [card()]), receipt(uuid(54), "bob", [card()])]).verdict, ProvenanceVerdict.INVALID);
    assert.match(trace([receipt(uuid(55), "alice", [card()]), trade({ n: 7, from: "alice", to: "bob", gives: [card(COPY, { serial: 1 })] })]).problem, /another printing/);
    const first = trade({ n: 8, from: "alice", to: "bob", gives: [card()] });
    const conflicting = op(OperationId.TRADE, tradeRecord({ tradeId: uuid(108), proposer: { account: "alice", cards: [card()] }, counterparty: { account: "carol", cards: [] } }));
    assert.match(trace([receipt(uuid(56), "alice", [card()]), first, conflicting]).problem, /two different records/);
    const minted = receipt(uuid(57), "alice", [card()]);
    const once = trade({ n: 9, from: "alice", to: "bob", gives: [card()] });
    const repeated = trace([minted, once, { ...once, blockNum: once.blockNum + 5, txId: testHex("again", 20) }]);
    assert.equal(repeated.transfers.length, 1, "the same record published twice moves the copy once");
    const early = trade({ n: 11, from: "alice", to: "bob", gives: [card()] });
    assert.match(trace([early, receipt(uuid(59), "alice", [card()])]).problem, /before it was minted/);
  });

  it("reads receipts and trades from the authorised broadcasters' histories", async () => {
    const manifest = Object.freeze({ ...operation(broadcastersManifest({ accounts: [BROADCASTER], fromBlock: 0 }), { blockNum: 900, txId: testHex("manifest", 20), id: OperationId.MANIFEST, requiredAuths: ["m8tcg"] }), requiredPostingAuths: [] });
    const all = [manifest, receipt(uuid(58), "alice", [card()]), trade({ n: 10, from: "alice", to: "bob", gives: [card()] })];
    const reader = {
      head: async () => ({ headBlock: 5020, irreversibleBlock: 5000, time: 0 }),
      publications: async (account, after) => (after >= 0 ? [] : all.filter((one) => (one.requiredAuths[0] ?? one.requiredPostingAuths[0]) === account).map((one, index) => ({ index, operation: one }))),
      blockOperations: async () => [],
    };
    const result = await verifyCopyOnChain({ copyId: COPY, reader, rootAccount: "m8tcg" });
    assert.deepEqual([result.verdict, result.owner, result.complete, result.broadcasters], [ProvenanceVerdict.VALID, "bob", true, [BROADCASTER]]);
    assert.equal(canonicalize(result.transfers[0]).includes("alice"), true);
  });
});
