/**
 * Listings and purchases of the public board (docs/tcg/14-vendite.md).
 *
 * A listing: one copy a player sells for a price, in escrow while ACTIVE.
 *
 *   ACTIVE ──a purchase completes─▶ SOLD
 *   ACTIVE ──cancel (seller)──────▶ CANCELLED   only while nobody is paying
 *   ACTIVE ──time runs out────────▶ EXPIRED     only while nobody is paying
 *
 * A purchase: a buyer's reservation of a listing. The buyer pays the seller
 * directly on chain, with the purchase's memo; the server only watches.
 *
 *   PENDING ──matching transfer seen───▶ DETECTED ──irreversible──▶ COMPLETED
 *   PENDING ──time runs out / release──▶ EXPIRED / CANCELLED
 *   DETECTED ──transfer left the chain─▶ PENDING
 *
 * Every change is a compare-and-set on the status.
 */

export const ListingStatus = Object.freeze({ ACTIVE: "ACTIVE", SOLD: "SOLD", CANCELLED: "CANCELLED", EXPIRED: "EXPIRED" });

export const PurchaseStatus = Object.freeze({ PENDING: "PENDING", DETECTED: "DETECTED", COMPLETED: "COMPLETED", EXPIRED: "EXPIRED", CANCELLED: "CANCELLED" });

/**
 * Purchases that hold their listing: nobody else may buy it, and the seller may not withdraw it.
 * @type {readonly string[]}
 */
export const LIVE_PURCHASE = Object.freeze([PurchaseStatus.PENDING, PurchaseStatus.DETECTED]);

/** Orders of the public board. */
export const BoardSort = Object.freeze({ NEWEST: "newest", CHEAPEST: "cheapest" });

/** Why a transfer carrying a purchase's memo does not pay it. */
export const SaleProblem = Object.freeze({
  WRONG_RECEIVER: "WRONG_RECEIVER",
  WRONG_ASSET: "WRONG_ASSET",
  WRONG_AMOUNT: "WRONG_AMOUNT",
  WRONG_SENDER: "WRONG_SENDER",
  LATE: "LATE",
});

/**
 * @typedef {Readonly<{
 *   id: string, sellerId: string, cardInstanceId: string, definitionId: string, network: string, asset: string, price: number,
 *   status: string, idempotencyKey: string, requestHash: string, createdAt: number, expiresAt: number, closedAt: number | null,
 * }>} Listing
 * @typedef {Readonly<{ txId: string, opIndex: number, blockNum: number, time: number }>} PaidBy the transfer that pays a purchase
 * @typedef {Readonly<{
 *   id: string, listingId: string, buyerId: string, payer: string, receiver: string, network: string, asset: string, amount: number,
 *   memo: string, status: string, startCursor: number, cursor: number, paidBy: PaidBy | null, problem: string | null,
 *   vanished: Readonly<{ txId: string, blockNum: number }> | null, createdAt: number, expiresAt: number, closedAt: number | null,
 * }>} Purchase
 */

/** Memo prefix of payments to sellers: distinct from the shop's, so neither watcher mistakes one for the other. */
export const SALE_MEMO_PREFIX = "m8sale-";
export const SALE_MEMO_PATTERN = /^m8sale-[a-z2-7]{26}$/;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * An opaque, unguessable payment reference (130 random bits, lowercase base32).
 * Transfers are public: the memo says nothing but "this purchase".
 * @param {Uint8Array} bytes at least 17 random bytes
 */
export function saleMemoFrom(bytes) {
  if (bytes.length < 17) {
    throw new RangeError("saleMemoFrom: needs 17 random bytes");
  }
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 26) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return `${SALE_MEMO_PREFIX}${out}`;
}

/**
 * Whether a transfer that carries the purchase's memo pays it: every field
 * must be what the purchase asked for. The block's time decides lateness,
 * not when the watcher saw it.
 * @param {Purchase} purchase
 * @param {Readonly<{ from: string, to: string, asset: string, amount: number, time: number }>} transfer
 * @returns {string | null} a SaleProblem, or null when the transfer pays the purchase
 */
export function matchSaleTransfer(purchase, transfer) {
  if (transfer.to !== purchase.receiver) {
    return SaleProblem.WRONG_RECEIVER;
  }
  if (transfer.asset !== purchase.asset) {
    return SaleProblem.WRONG_ASSET;
  }
  if (transfer.amount !== purchase.amount) {
    return SaleProblem.WRONG_AMOUNT;
  }
  if (transfer.from !== purchase.payer) {
    return SaleProblem.WRONG_SENDER;
  }
  if (transfer.time > purchase.expiresAt) {
    return SaleProblem.LATE;
  }
  return null;
}
