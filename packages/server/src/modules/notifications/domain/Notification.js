/**
 * Notifications (docs/tcg/15-notifiche.md): one row per thing a player
 * should hear about, written with the change it reports. `kind` says what
 * happened, `data` carries what the client needs to say it (ids, accounts,
 * card definition ids) — never text: the client words it, in its language.
 *
 * @typedef {Readonly<{ id: number, userId: string, kind: string, data: Readonly<Record<string, unknown>>, createdAt: number, readAt: number | null }>} Notification
 */

export const NotificationKind = Object.freeze({
  /** A shop order's cards are in the collection. */
  ORDER_FULFILLED: "shop.fulfilled",
  /** A payment for an order did not match it; it will be refunded. */
  ORDER_REFUND: "shop.refund",
  TRADE_OFFERED: "trade.offered",
  TRADE_ACCEPTED: "trade.accepted",
  TRADE_DECLINED: "trade.declined",
  TRADE_CANCELLED: "trade.cancelled",
  TRADE_EXPIRED: "trade.expired",
  /** To the seller: their card was paid for and passed to the buyer. */
  SALE_SOLD: "sale.sold",
  /** To the buyer: the card they paid for is theirs. */
  SALE_BOUGHT: "sale.bought",
  SALE_LISTING_EXPIRED: "sale.listing_expired",
  SALE_RESERVATION_EXPIRED: "sale.reservation_expired",
  SALE_PAYMENT_PROBLEM: "sale.payment_problem",
});

/** @type {ReadonlySet<string>} */
const KINDS = new Set(Object.values(NotificationKind));
/** A notification's data, as JSON, stays small: it is pushed and listed often. */
export const MAX_DATA_BYTES = 4096;

/**
 * @param {string} kind
 * @param {unknown} data
 * @returns {string | null} the problem, or null when the notification may be written
 */
export function checkNotification(kind, data) {
  if (!KINDS.has(kind)) {
    return `unknown notification kind "${kind}"`;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return "notification data must be an object";
  }
  if (new TextEncoder().encode(JSON.stringify(data)).length > MAX_DATA_BYTES) {
    return `notification data is larger than ${MAX_DATA_BYTES} bytes`;
  }
  return null;
}

/**
 * Copies of the same card, counted: what a notification says about cards.
 * @param {readonly { definitionId: string }[]} copies
 * @param {number} [limit] distinct cards kept (the rest is summarised by the total)
 * @returns {readonly Readonly<{ definitionId: string, count: number }>[]}
 */
export function countCards(copies, limit = 40) {
  const counts = new Map();
  for (const copy of copies) {
    counts.set(copy.definitionId, (counts.get(copy.definitionId) ?? 0) + 1);
  }
  return Object.freeze([...counts].slice(0, limit).map(([definitionId, count]) => Object.freeze({ definitionId, count })));
}

/**
 * What the player sees of a notification.
 * @param {Notification} notification
 */
export function notificationView({ id, kind, data, createdAt, readAt }) {
  return Object.freeze({ id, kind, data, createdAt, read: readAt !== null });
}
