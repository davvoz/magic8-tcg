/**
 * Provably fair booster packs (docs/tcg/01-architettura.md §7.2).
 *
 * For each pack epoch the server draws a 32-byte secret E and publishes
 * commit = H("pack-epoch", E) before selling any pack of that epoch. The seed
 * of pack `index` of an order is
 *
 *   seed = HMAC-SHA256(key = E, "m8tcg/v1/pack" ‖ 0x00 ‖ utf8(canonical([orderId, txId, index])))
 *
 * where txId is the payment transaction: the server cannot know it before the
 * player pays, and the player cannot know E. The pack is then drawn from a
 * resolved drop table with the engine's ChaCha20 generator keyed by the seed.
 * When the epoch closes, E is revealed; anyone can recompute every pack from
 * the receipts and the drop table (identified by its hash).
 *
 * Everything here is pure and deterministic, and runs in the browser too.
 *
 * @typedef {Readonly<{ count: number, weights: Readonly<Record<string, number>> }>} DropSlot
 * @typedef {Readonly<{ numerator: number, denominator: number }>} Chance
 * @typedef {Readonly<{ v: 1, id: string, edition: string, slots: readonly DropSlot[], foil: Chance, pools: Readonly<Record<string, readonly string[]>> }>} DropTable
 *   A drop table with its card pools resolved: pools list card ids per rarity, sorted.
 * @typedef {Readonly<{ cardId: string, rarity: string, finish: string }>} PackCard
 */
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ChaChaRandom } from "@magic8/engine/domain/random/ChaChaRandom.js";
import { canonicalize } from "../canonical/CanonicalJson.js";
import { HashTag, bytesToHex, concatBytes, hexToBytes, isHexOfLength, taggedHashHex, utf8 } from "../crypto/hash.js";
import { CARD_ID_PATTERN } from "../game/constants.js";
import { ProtocolError } from "../game/ProtocolError.js";

export const DROP_TABLE_VERSION = 1;
export const PACK_SECRET_BYTES = 32;
export const Finish = Object.freeze({ STANDARD: "standard", FOIL: "foil" });

const PACK_LABEL = utf8("m8tcg/v1/pack");
const SEPARATOR = new Uint8Array([0]);
const TABLE_KEYS = Object.freeze(["v", "id", "edition", "slots", "foil", "pools"]);
const TABLE_ID_PATTERN = /^[a-z0-9_]{1,40}$/;
const EDITION_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const RARITY_PATTERN = /^[a-z][a-z0-9_]{0,23}$/;
const MAX_SLOTS = 10;
const MAX_PACK_CARDS = 20;
const MAX_WEIGHT = 1_000_000;
const MAX_POOL = 1000;
const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TX_ID_PATTERN = /^[0-9a-f]{40}$/;
const MAX_PACK_INDEX = 10_000;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isInt = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

/**
 * Structural check of a resolved drop table; throws ProtocolError with the first problem.
 * @param {unknown} table
 * @returns {DropTable}
 */
export function validateDropTable(table) {
  if (!isObject(table) || Object.keys(table).some((key) => !TABLE_KEYS.includes(key)) || TABLE_KEYS.some((key) => !(key in table))) {
    throw new ProtocolError(`a drop table has exactly the fields ${TABLE_KEYS.join(", ")}`);
  }
  const candidate = /** @type {any} */ (table);
  checkHeader(candidate);
  checkPools(candidate.pools);
  checkSlots(candidate.slots, candidate.pools);
  const foil = candidate.foil;
  if (!isObject(foil) || Object.keys(foil).length !== 2 || !isInt(foil.denominator, 1, MAX_WEIGHT) || !isInt(foil.numerator, 0, foil.denominator)) {
    throw new ProtocolError("foil must be { numerator, denominator } with 0 ≤ numerator ≤ denominator");
  }
  return /** @type {DropTable} */ (table);
}

/** @param {any} table */
function checkHeader(table) {
  const idValid = typeof table.id === "string" && TABLE_ID_PATTERN.test(table.id);
  const editionValid = typeof table.edition === "string" && EDITION_PATTERN.test(table.edition);
  if (table.v !== DROP_TABLE_VERSION || !idValid || !editionValid) {
    throw new ProtocolError("invalid drop table version, id or edition");
  }
}

/** @param {unknown} pools */
function checkPools(pools) {
  if (!isObject(pools) || Object.keys(pools).length === 0) {
    throw new ProtocolError("pools must map rarities to card ids");
  }
  for (const [rarity, ids] of Object.entries(/** @type {Record<string, unknown>} */ (pools))) {
    if (!RARITY_PATTERN.test(rarity) || !Array.isArray(ids) || ids.length === 0 || ids.length > MAX_POOL) {
      throw new ProtocolError(`pool "${rarity}" must be a non-empty list of card ids`);
    }
    ids.forEach((id, index) => {
      if (typeof id !== "string" || !CARD_ID_PATTERN.test(id) || (index > 0 && ids[index - 1] >= id)) {
        throw new ProtocolError(`pool "${rarity}" must list valid card ids, sorted and without duplicates`);
      }
    });
  }
}

/**
 * @param {unknown} slots
 * @param {Record<string, unknown>} pools
 */
function checkSlots(slots, pools) {
  if (!Array.isArray(slots) || slots.length === 0 || slots.length > MAX_SLOTS) {
    throw new ProtocolError(`a drop table has 1..${MAX_SLOTS} slots`);
  }
  let cards = 0;
  for (const slot of slots) {
    if (!isObject(slot) || Object.keys(slot).length !== 2 || !isInt(slot.count, 1, MAX_PACK_CARDS) || !isObject(slot.weights)) {
      throw new ProtocolError("a slot is { count, weights }");
    }
    const weights = Object.entries(slot.weights);
    if (weights.length === 0 || weights.some(([rarity, weight]) => !(rarity in pools) || !isInt(weight, 1, MAX_WEIGHT))) {
      throw new ProtocolError("slot weights must be positive integers for rarities that have a pool");
    }
    cards += slot.count;
  }
  if (cards > MAX_PACK_CARDS) {
    throw new ProtocolError(`a pack holds at most ${MAX_PACK_CARDS} cards`);
  }
}

/**
 * Identity of a resolved drop table: receipts and product listings name it by this hash.
 * @param {DropTable} table
 * @returns {string}
 */
export function dropTableHash(table) {
  return taggedHashHex(HashTag.DROP_TABLE, utf8(canonicalize(validateDropTable(table))));
}

/**
 * The public commitment to an epoch secret.
 * @param {string} secret 32 bytes as lowercase hex
 * @returns {string}
 */
export function packEpochCommitment(secret) {
  return taggedHashHex(HashTag.PACK_EPOCH, secretBytes(secret));
}

/**
 * @param {{ secret: string, orderId: string, txId: string, index: number }} inputs
 * @returns {string} the pack seed, 32 bytes as lowercase hex
 */
export function packSeed({ secret, orderId, txId, index }) {
  if (typeof orderId !== "string" || !ORDER_ID_PATTERN.test(orderId)) {
    throw new ProtocolError("orderId must be a lowercase UUID");
  }
  if (typeof txId !== "string" || !TX_ID_PATTERN.test(txId)) {
    throw new ProtocolError("txId must be a transaction id (40 lowercase hex characters)");
  }
  if (!isInt(index, 0, MAX_PACK_INDEX)) {
    throw new ProtocolError(`pack index must be an integer in 0..${MAX_PACK_INDEX}`);
  }
  const message = concatBytes(PACK_LABEL, SEPARATOR, utf8(canonicalize([orderId, txId, index])));
  return bytesToHex(hmac(sha256, secretBytes(secret), message));
}

/**
 * Draws one pack. Slots in order; within a slot each card picks a rarity by
 * weight (rarities in sorted order), then a card uniformly from that pool,
 * then its finish.
 * @param {DropTable} table
 * @param {string} seed 32 bytes as lowercase hex (from packSeed)
 * @returns {readonly PackCard[]}
 */
export function drawPack(table, seed) {
  validateDropTable(table);
  if (!isHexOfLength(seed, PACK_SECRET_BYTES)) {
    throw new ProtocolError("the pack seed must be 32 bytes as lowercase hex");
  }
  const random = new ChaChaRandom(hexToBytes(seed));
  /** @type {PackCard[]} */
  const cards = [];
  for (const slot of table.slots) {
    const rarities = Object.keys(slot.weights).sort();
    const total = rarities.reduce((sum, rarity) => sum + slot.weights[rarity], 0);
    for (let drawn = 0; drawn < slot.count; drawn += 1) {
      const rarity = pickWeighted(rarities, slot.weights, random.nextInt(total));
      const pool = table.pools[rarity];
      const cardId = pool[random.nextInt(pool.length)];
      const finish = random.nextInt(table.foil.denominator) < table.foil.numerator ? Finish.FOIL : Finish.STANDARD;
      cards.push(Object.freeze({ cardId, rarity, finish }));
    }
  }
  return Object.freeze(cards);
}

/**
 * Probability of each rarity per slot, for the product listing (the law
 * of many countries requires disclosing pack odds).
 * @param {DropTable} table
 * @returns {readonly Readonly<{ count: number, odds: Readonly<Record<string, Chance>> }>[]}
 */
export function dropTableOdds(table) {
  validateDropTable(table);
  return Object.freeze(
    table.slots.map((slot) => {
      const total = Object.values(slot.weights).reduce((sum, weight) => sum + weight, 0);
      const odds = Object.fromEntries(Object.keys(slot.weights).sort().map((rarity) => [rarity, Object.freeze({ numerator: slot.weights[rarity], denominator: total })]));
      return Object.freeze({ count: slot.count, odds: Object.freeze(odds) });
    }),
  );
}

/**
 * @param {readonly string[]} rarities sorted
 * @param {Readonly<Record<string, number>>} weights
 * @param {number} roll in 0..total-1
 */
function pickWeighted(rarities, weights, roll) {
  let remaining = roll;
  for (const rarity of rarities) {
    if (remaining < weights[rarity]) {
      return rarity;
    }
    remaining -= weights[rarity];
  }
  throw new ProtocolError("weighted roll out of range");
}

/** @param {unknown} secret */
function secretBytes(secret) {
  if (!isHexOfLength(secret, PACK_SECRET_BYTES)) {
    throw new ProtocolError("an epoch secret is 32 bytes as lowercase hex");
  }
  return hexToBytes(/** @type {string} */ (secret));
}
