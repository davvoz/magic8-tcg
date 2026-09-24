import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Finish, ProtocolError, drawPack, dropTableHash, dropTableOdds, packEpochCommitment, packSeed, validateDropTable } from "../src/index.js";

const SECRET = "11".repeat(32);
const ORDER = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TX = "ab".repeat(20);

/** @returns {any} */
function table(overrides = {}) {
  return {
    v: 1,
    id: "core_booster",
    edition: "core-1",
    slots: [
      { count: 3, weights: { common: 1 } },
      { count: 1, weights: { uncommon: 1 } },
      { count: 1, weights: { rare: 88, epic: 10, legendary: 2 } },
    ],
    foil: { numerator: 1, denominator: 20 },
    pools: {
      common: ["c1", "c2", "c3", "c4"],
      uncommon: ["u1", "u2"],
      rare: ["r1", "r2"],
      epic: ["e1"],
      legendary: ["l1"],
    },
    ...overrides,
  };
}

describe("packs", () => {
  it("derives a seed that depends on every input and on the secret", () => {
    const base = packSeed({ secret: SECRET, orderId: ORDER, txId: TX, index: 0 });
    assert.match(base, /^[0-9a-f]{64}$/);
    assert.equal(packSeed({ secret: SECRET, orderId: ORDER, txId: TX, index: 0 }), base, "deterministic");
    const variants = [
      packSeed({ secret: "22".repeat(32), orderId: ORDER, txId: TX, index: 0 }),
      packSeed({ secret: SECRET, orderId: ORDER.replace("0f8f", "1f8f"), txId: TX, index: 0 }),
      packSeed({ secret: SECRET, orderId: ORDER, txId: "cd".repeat(20), index: 0 }),
      packSeed({ secret: SECRET, orderId: ORDER, txId: TX, index: 1 }),
    ];
    assert.equal(new Set([base, ...variants]).size, 5);
    assert.throws(() => packSeed({ secret: "11", orderId: ORDER, txId: TX, index: 0 }), ProtocolError);
    assert.throws(() => packSeed({ secret: SECRET, orderId: "ORDER", txId: TX, index: 0 }), ProtocolError);
    assert.throws(() => packSeed({ secret: SECRET, orderId: ORDER, txId: "zz", index: 0 }), ProtocolError);
    assert.throws(() => packSeed({ secret: SECRET, orderId: ORDER, txId: TX, index: -1 }), ProtocolError);
  });

  it("commits to the epoch secret with its own hash domain", () => {
    const commit = packEpochCommitment(SECRET);
    assert.match(commit, /^[0-9a-f]{64}$/);
    assert.notEqual(commit, packEpochCommitment("22".repeat(32)));
    assert.throws(() => packEpochCommitment("xyz"), ProtocolError);
  });

  it("draws the same pack from the same seed, slot by slot", () => {
    const seed = packSeed({ secret: SECRET, orderId: ORDER, txId: TX, index: 0 });
    const pack = drawPack(table(), seed);
    assert.deepEqual(drawPack(table(), seed), pack);
    assert.equal(pack.length, 5);
    assert.deepEqual(pack.slice(0, 3).map((card) => card.rarity), ["common", "common", "common"]);
    assert.equal(pack[3].rarity, "uncommon");
    assert.ok(["rare", "epic", "legendary"].includes(pack[4].rarity));
    for (const card of pack) {
      assert.ok(table().pools[card.rarity].includes(card.cardId));
      assert.ok([Finish.STANDARD, Finish.FOIL].includes(card.finish));
    }
  });

  it("pins the draw algorithm (a change here breaks every published pack)", () => {
    const seed = packSeed({ secret: SECRET, orderId: ORDER, txId: TX, index: 0 });
    assert.equal(seed, PINNED.seed);
    assert.deepEqual(drawPack(table(), seed).map((card) => `${card.cardId}:${card.finish}`), PINNED.cards);
  });

  it("follows the weights and the foil chance over many packs", () => {
    const counts = { rare: 0, epic: 0, legendary: 0 };
    let foils = 0;
    const packs = 4000;
    for (let index = 0; index < packs; index += 1) {
      const pack = drawPack(table(), packSeed({ secret: SECRET, orderId: ORDER, txId: TX, index }));
      counts[pack[4].rarity] += 1;
      foils += pack.filter((card) => card.finish === Finish.FOIL).length;
    }
    assert.ok(Math.abs(counts.rare / packs - 0.88) < 0.03, JSON.stringify(counts));
    assert.ok(Math.abs(counts.epic / packs - 0.1) < 0.03, JSON.stringify(counts));
    assert.ok(counts.legendary > 20 && counts.legendary < 150, JSON.stringify(counts));
    assert.ok(Math.abs(foils / (packs * 5) - 0.05) < 0.01, `foil rate ${foils / (packs * 5)}`);
  });

  it("identifies a table by hash and publishes its odds", () => {
    const hash = dropTableHash(table());
    assert.equal(hash, dropTableHash(table()));
    assert.notEqual(hash, dropTableHash(table({ foil: { numerator: 2, denominator: 20 } })));
    assert.deepEqual(dropTableOdds(table())[2], { count: 1, odds: { epic: { numerator: 10, denominator: 100 }, legendary: { numerator: 2, denominator: 100 }, rare: { numerator: 88, denominator: 100 } } });
  });

  it("refuses malformed tables", () => {
    const bad = [
      table({ v: 2 }),
      table({ extra: 1 }),
      table({ id: "Core Booster" }),
      table({ slots: [] }),
      table({ slots: [{ count: 1, weights: { mythic: 1 } }] }),
      table({ slots: [{ count: 1, weights: { common: 0 } }] }),
      table({ slots: [{ count: 21, weights: { common: 1 } }] }),
      table({ pools: { common: ["c2", "c1"] }, slots: [{ count: 1, weights: { common: 1 } }] }),
      table({ pools: { common: [] }, slots: [{ count: 1, weights: { common: 1 } }] }),
      table({ foil: { numerator: 3, denominator: 2 } }),
    ];
    for (const candidate of bad) {
      assert.throws(() => validateDropTable(candidate), ProtocolError, JSON.stringify(candidate));
    }
    assert.throws(() => drawPack(table(), "00"), ProtocolError);
  });
});

const PINNED = Object.freeze({ seed: "d1bc3dc2c0d3b1b3ebf7b2222fbc1b5f60f3eb492514e4cd254d8ecfddb36260", cards: ["c4:standard", "c3:standard", "c3:standard", "u1:standard", "r2:standard"] });
