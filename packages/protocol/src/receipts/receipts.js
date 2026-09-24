/**
 * Fulfilment receipts (`custom_json` m8tcg_receipt,
 * docs/tcg/03-game-blockchain-protocol.md §12). A receipt publicly links a
 * payment, an order and the copies minted for it, so anyone can check that
 * cards were not created out of nothing and, once the pack epoch is
 * revealed, that every pack is what its seed draws.
 *
 *   {"cards":[[id, definitionId, serial, finish]…],"items":[{"p":productId,"q":quantity}…],
 *    "o":orderId,"packs":[{"epoch":n,"idx":i,"t":dropTableHash}…],"part":[n,total],
 *    "pay":{"net":network,"tx":txId},"u":account,"v":1}
 *
 * Finishes are abbreviated ("s" standard, "f" foil). A receipt larger than
 * one operation (8 KB) is split into parts: every part repeats the order,
 * payment, items and packs, and carries a slice of the cards.
 */
import { canonicalize, utf8Length } from "../canonical/CanonicalJson.js";
import { LIMITS } from "../game/constants.js";
import { ProtocolError } from "../game/ProtocolError.js";

export const RECEIPT_VERSION = 1;
export const FINISH_CODES = Object.freeze({ standard: "s", foil: "f" });

/**
 * @typedef {Readonly<{ id: string, definitionId: string, serial: number, finish: string }>} ReceiptCard
 * @typedef {Readonly<{ epoch: number, index: number, table: string }>} ReceiptPack
 * @typedef {Readonly<{
 *   orderId: string, account: string, network: string, txId: string,
 *   items: readonly Readonly<{ productId: string, quantity: number }>[],
 *   packs: readonly ReceiptPack[], cards: readonly ReceiptCard[],
 * }>} ReceiptInput
 */

/**
 * @param {ReceiptInput} input
 * @param {{ maxBytes?: number }} [options]
 * @returns {readonly string[]} the canonical JSON of each part, in order
 */
export function buildReceipts(input, { maxBytes = LIMITS.MAX_OPERATION_BYTES } = {}) {
  const cards = input.cards.map((card) => {
    const finish = FINISH_CODES[/** @type {keyof typeof FINISH_CODES} */ (card.finish)];
    if (finish === undefined) {
      throw new ProtocolError(`receipt: unknown finish "${card.finish}"`);
    }
    return [card.id, card.definitionId, card.serial, finish];
  });
  const base = {
    items: input.items.map((item) => ({ p: item.productId, q: item.quantity })),
    o: input.orderId,
    packs: input.packs.map((pack) => ({ epoch: pack.epoch, idx: pack.index, t: pack.table })),
    pay: { net: input.network, tx: input.txId },
    u: input.account,
    v: RECEIPT_VERSION,
  };
  /** @type {unknown[][][]} */
  const slices = [];
  let current = [];
  for (const card of cards) {
    const candidate = [...current, card];
    if (current.length > 0 && utf8Length(canonicalize({ ...base, cards: candidate, part: [99, 99] })) > maxBytes) {
      slices.push(current);
      current = [card];
    } else {
      current = candidate;
    }
  }
  slices.push(current);
  const parts = slices.map((slice, index) => canonicalize({ ...base, cards: slice, part: [index + 1, slices.length] }));
  for (const part of parts) {
    if (utf8Length(part) > maxBytes) {
      throw new ProtocolError(`receipt part of ${utf8Length(part)} bytes exceeds ${maxBytes}: too many items or packs for one operation`);
    }
  }
  return Object.freeze(parts);
}
