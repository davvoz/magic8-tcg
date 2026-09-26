/**
 * Orders and their state machine (docs/tcg/01-architettura.md §7.2).
 * Every transition is a compare-and-set in the repository: it happens only
 * if the order is still in the expected state, so two workers, a retry or a
 * payment racing an expiry can never both win.
 *
 * @typedef {Readonly<{ position: number, productId: string, quantity: number, unitAmount: number }>} OrderItem
 * @typedef {Readonly<{
 *   id: string, userId: string, status: string, network: string, asset: string,
 *   totalAmount: number, receiver: string, payer: string, memo: string, expiresAt: number,
 *   idempotencyKey: string, requestHash: string, paymentId: string | null,
 *   rngEpochId: number | null, failureReason: string | null, version: number,
 *   createdAt: number, updatedAt: number, items: readonly OrderItem[],
 * }>} Order
 */

export const OrderStatus = Object.freeze({
  CREATED: "CREATED",
  PAYMENT_PENDING: "PAYMENT_PENDING",
  PAYMENT_DETECTED: "PAYMENT_DETECTED",
  PAYMENT_VERIFIED: "PAYMENT_VERIFIED",
  FULFILLED: "FULFILLED",
  FAILED: "FAILED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
});

/** from → allowed destinations */
export const ORDER_TRANSITIONS = Object.freeze({
  [OrderStatus.CREATED]: Object.freeze([OrderStatus.PAYMENT_PENDING, OrderStatus.CANCELLED]),
  [OrderStatus.PAYMENT_PENDING]: Object.freeze([OrderStatus.PAYMENT_DETECTED, OrderStatus.EXPIRED, OrderStatus.CANCELLED]),
  [OrderStatus.PAYMENT_DETECTED]: Object.freeze([OrderStatus.PAYMENT_VERIFIED, OrderStatus.FAILED, OrderStatus.PAYMENT_PENDING]),
  [OrderStatus.PAYMENT_VERIFIED]: Object.freeze([OrderStatus.FULFILLED]),
  [OrderStatus.FULFILLED]: Object.freeze([]),
  [OrderStatus.FAILED]: Object.freeze([]),
  [OrderStatus.EXPIRED]: Object.freeze([]),
  [OrderStatus.CANCELLED]: Object.freeze([]),
});

/**
 * States in which a payment can still be accepted for the order.
 * @type {readonly string[]}
 */
export const AWAITING_PAYMENT = Object.freeze([OrderStatus.CREATED, OrderStatus.PAYMENT_PENDING]);
/** States that count as "open" for the per-user limit. */
export const OPEN_STATUSES = Object.freeze([OrderStatus.CREATED, OrderStatus.PAYMENT_PENDING, OrderStatus.PAYMENT_DETECTED, OrderStatus.PAYMENT_VERIFIED]);

/**
 * @param {string} from
 * @param {string} to
 */
export function canTransition(from, to) {
  return /** @type {readonly string[] | undefined} */ (ORDER_TRANSITIONS[/** @type {keyof typeof ORDER_TRANSITIONS} */ (from)])?.includes(to) ?? false;
}

/** Memo prefix: lets a player (and the payment watcher) recognise our references. */
export const MEMO_PREFIX = "m8tcg-";
export const MEMO_PATTERN = /^m8tcg-[a-z2-7]{26}$/;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * An opaque, unguessable payment reference: 130 random bits in lowercase
 * base32. It identifies one order and says nothing about it; transfers are
 * public, so the memo must not carry anything but a reference.
 * @param {Uint8Array} bytes at least 17 random bytes
 * @returns {string}
 */
export function memoFrom(bytes) {
  if (bytes.length < 17) {
    throw new RangeError("memoFrom: needs 17 random bytes");
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
  return `${MEMO_PREFIX}${out}`;
}
