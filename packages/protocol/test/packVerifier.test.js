/**
 * verifyOrderPacks on synthetic chain operations: a receipt, its epoch's
 * commitment and reveal; every way the evidence can be missing, late,
 * forged or inconsistent.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OperationId,
  PackVerdict,
  buildReceipts,
  drawPack,
  dropTableHash,
  packEpochAnnouncement,
  packEpochCommitment,
  packEpochReveal,
  packSeed,
  verifyOrderPacks,
} from "../src/index.js";

const SECRET = "11".repeat(32);
const ORDER = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TX = "ab".repeat(20);
const B1 = "m8tcg-b1";
const TABLE = Object.freeze({
  v: 1,
  id: "core_booster",
  edition: "core-1",
  slots: [
    { count: 3, weights: { common: 1 } },
    { count: 1, weights: { uncommon: 1 } },
    { count: 1, weights: { rare: 88, epic: 10, legendary: 2 } },
  ],
  pools: { common: ["c1", "c2", "c3", "c4"], uncommon: ["u1", "u2"], rare: ["r1", "r2"], epic: ["e1"], legendary: ["l1"] },
});
const HASH = dropTableHash(TABLE);

let txCounter = 0;
/**
 * @param {string} id
 * @param {string} json
 * @param {number} blockNum
 * @param {string} [signer]
 */
function op(id, json, blockNum, signer = B1) {
  txCounter += 1;
  return Object.freeze({ network: "steem", txId: txCounter.toString(16).padStart(40, "0"), blockNum, opIndex: 0, id, requiredAuths: [], requiredPostingAuths: [signer], json });
}

/** The receipt parts of an order of two packs, with the cards the seeds draw (or `cards` if given). */
function receipt({ cards, maxBytes } = {}) {
  const drawn = [0, 1].flatMap((index) => drawPack(TABLE, packSeed({ secret: SECRET, orderId: ORDER, txId: TX, index })));
  const minted = cards ?? drawn.map((card, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, definitionId: card.cardId, serial: index + 1 }));
  return buildReceipts(
    { orderId: ORDER, account: "alice", network: "steem", txId: TX, items: [{ productId: "core_booster", quantity: 2 }], packs: [0, 1].map((index) => ({ epoch: 1, index, table: HASH })), cards: minted },
    maxBytes === undefined ? {} : { maxBytes },
  );
}

const commit = (blockNum = 10) => op(OperationId.EPOCH, packEpochAnnouncement(1, packEpochCommitment(SECRET)), blockNum);
const reveal = (secret = SECRET) => op(OperationId.EPOCH, packEpochReveal(1, secret), 90);
const receiptOps = (parts = receipt(), blockNum = 50) => parts.map((json) => op(OperationId.RECEIPT, json, blockNum));

/**
 * @param {readonly any[]} operations
 * @param {{ paymentBlock?: number, tables?: Map<string, unknown> }} [options]
 */
const verify = (operations, { paymentBlock = 40, tables = new Map([[HASH, TABLE]]) } = {}) =>
  verifyOrderPacks({ orderId: ORDER, operations, isAuthorizedBroadcaster: (account) => account === B1, dropTables: tables, paymentBlock });

describe("verifyOrderPacks", () => {
  it("accepts packs that are exactly what their seeds draw, with a commitment before the payment", () => {
    const result = verify([commit(), ...receiptOps(), reveal()]);
    assert.equal(result.verdict, PackVerdict.VALID, result.problem);
    assert.equal(result.packs.length, 2);
    assert.equal(result.receipt.otherCards, 0);
    const split = verify([commit(), ...receiptOps(receipt({ maxBytes: 700 })), reveal()]);
    assert.equal(split.verdict, PackVerdict.VALID, "a receipt split in parts is joined");
    const duplicated = verify([commit(), ...receiptOps(), ...receiptOps(), reveal()]);
    assert.equal(duplicated.verdict, PackVerdict.VALID, "identical duplicates (a rebroadcast) are harmless");
  });

  it("reports what is missing, late, forged or inconsistent", () => {
    assert.equal(verify([commit(), reveal()]).verdict, PackVerdict.NOT_FOUND);
    assert.equal(verify([commit(), ...receipt().map((json) => op(OperationId.RECEIPT, json, 50, "mallory")), reveal()]).verdict, PackVerdict.NOT_FOUND, "a receipt from an unauthorised account does not count");
    assert.equal(verify([...receiptOps(), reveal()]).problem, "epoch 1 has no commitment on chain");
    assert.match(verify([commit(60), ...receiptOps(), reveal()]).problem, /committed on chain only after/, "committed after the receipt");
    assert.match(verify([commit(45), ...receiptOps(), reveal()]).problem, /committed on chain only after/, "committed after the payment");
    assert.equal(verify([commit(), ...receiptOps()]).verdict, PackVerdict.NOT_REVEALED);
    assert.match(verify([commit(), ...receiptOps(), reveal("22".repeat(32))]).problem, /does not match its commitment/);
    assert.match(verify([commit(), ...receiptOps(), reveal()], { tables: new Map([[HASH, { ...TABLE, edition: "core-2" }]]) }).problem, /no drop table hashing/);
    assert.match(verify([commit(), ...receiptOps(), reveal()], { tables: new Map([[HASH, { nonsense: true }]]) }).problem, /no drop table hashing/);

    const swapped = receipt({ cards: [{ id: "00000000-0000-4000-8000-000000000001", definitionId: "l1", serial: 1 }] });
    assert.match(verify([commit(), ...receiptOps(swapped), reveal()]).problem, /pack 0 is not what its seed draws/);

    const parts = receipt({ maxBytes: 700 });
    assert.ok(parts.length > 1);
    assert.match(verify([commit(), ...receiptOps(parts.slice(1)), reveal()]).problem, /part 1 of \d+ is not on chain/);
    const altered = JSON.parse(parts[1]);
    altered.u = "mallory";
    const keys = Object.keys(altered).sort();
    const reordered = JSON.stringify(Object.fromEntries(keys.map((key) => [key, altered[key]])));
    assert.match(verify([commit(), ...receiptOps([parts[0], reordered, ...parts.slice(2)]), reveal()]).problem, /disagrees with part 1/);
  });
});
