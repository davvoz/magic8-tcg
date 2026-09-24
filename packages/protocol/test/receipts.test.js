import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ProtocolError, buildReceipts, parseCanonical, utf8Length } from "../src/index.js";

const ORDER = "0f8fad5b-d9cb-469f-a165-70867728950e";
const card = (index, finish = "standard") => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, definitionId: "pyre_drake", serial: index + 1, finish });
const input = (cards) => ({ orderId: ORDER, account: "alice", network: "steem", txId: "ab".repeat(20), items: [{ productId: "core_booster", quantity: 2 }], packs: [{ epoch: 3, index: 0, table: "cd".repeat(32) }], cards });

describe("fulfilment receipts", () => {
  it("links payment, order, packs and copies in one canonical operation", () => {
    const [part, ...rest] = buildReceipts(input([card(0), card(1, "foil")]));
    assert.equal(rest.length, 0);
    const receipt = parseCanonical(part);
    assert.deepEqual(receipt, {
      cards: [[card(0).id, "pyre_drake", 1, "s"], [card(1).id, "pyre_drake", 2, "f"]],
      items: [{ p: "core_booster", q: 2 }],
      o: ORDER,
      packs: [{ epoch: 3, idx: 0, t: "cd".repeat(32) }],
      part: [1, 1],
      pay: { net: "steem", tx: "ab".repeat(20) },
      u: "alice",
      v: 1,
    });
  });

  it("splits a large receipt into parts of at most 8 KB that together list every card once", () => {
    const cards = Array.from({ length: 400 }, (_, index) => card(index));
    const parts = buildReceipts(input(cards));
    assert.ok(parts.length > 1);
    const listed = [];
    parts.forEach((text, index) => {
      assert.ok(utf8Length(text) <= 8192, `part ${index + 1} is ${utf8Length(text)} bytes`);
      const receipt = parseCanonical(text);
      assert.deepEqual(receipt.part, [index + 1, parts.length]);
      assert.equal(receipt.o, ORDER);
      listed.push(...receipt.cards.map((entry) => entry[0]));
    });
    assert.deepEqual(listed, cards.map((entry) => entry.id));
  });

  it("refuses finishes it cannot encode", () => {
    assert.throws(() => buildReceipts(input([card(0, "gold")])), ProtocolError);
  });
});
