/**
 * What a notification says (docs/tcg/15-notifiche.md). The server sends a
 * kind and data (ids, accounts, card definition ids); this turns them into
 * a title, a sentence, the cards to show and where the player can follow
 * it up. Pure, so every screen (toasts, the feed) words it the same way.
 */

/** Where a notification leads. */
export const NotificationTarget = Object.freeze({ COLLECTION: "collection", TRADES: "trades", MARKET: "market", SHOP: "shop" });

/** Kinds after which the player's collection has changed (it should be read again). */
export const COLLECTION_CHANGING_KINDS = Object.freeze(["shop.fulfilled", "trade.accepted", "trade.declined", "trade.cancelled", "trade.expired", "sale.sold", "sale.bought", "sale.listing_expired"]);

/** Most cards named in a sentence; the rest are counted. */
const NAMED_CARDS = 3;

const PAYMENT_PROBLEMS = Object.freeze({
  WRONG_AMOUNT: "the amount was wrong",
  WRONG_ASSET: "it was in the wrong currency",
  WRONG_SENDER: "it came from another account",
  LATE: "it arrived too late",
  UNKNOWN_MEMO: "its memo named no order",
  ORDER_NOT_PAYABLE: "the order could no longer be paid",
});

/**
 * @typedef {Readonly<{ definitionId: string, count?: number, caption?: string, serial?: number }>} NotificationCard
 * @typedef {Readonly<{ title: string, body: string, cards: readonly NotificationCard[], target: string | null, tone: "good" | "bad" | "info" }>} NotificationText
 * @typedef {{ data: Readonly<Record<string, any>>, account: string, name: (definitionId: unknown) => string, list: (cards: unknown) => string, single: NotificationCard | null, singleName: string, problem: string }} Facts
 */

/** @type {Readonly<Record<string, (facts: Facts) => NotificationText>>} */
const DESCRIBERS = Object.freeze({
  "shop.fulfilled": ({ data }) => {
    const cards = cardsOf(data.cards);
    const items = Array.isArray(data.items) ? data.items.map((item) => times(item.quantity) + item.name).join(", ") : "Your order";
    const total = Number.isSafeInteger(data.total) ? data.total : cards.reduce((sum, card) => sum + (card.count ?? 1), 0);
    return text({ title: "Your cards have arrived", body: `${items}: ${plural(total, "card")} added to your collection.`, cards, target: NotificationTarget.COLLECTION, tone: "good" });
  },
  "shop.refund": ({ data, problem }) => text({ title: "Payment to be refunded", body: `Your payment of ${data.amount ?? "?"} ${data.asset ?? ""} for an order was not accepted: ${problem}. It will be sent back to you.`, target: NotificationTarget.SHOP, tone: "bad" }),
  "trade.offered": ({ data, account, list, name }) => {
    const wants = cardsOf(data.wants);
    const asks = wants.length === 0 ? "as a gift" : `for ${cardsSentence(wants, name)}`;
    return text({ title: "New trade offer", body: `${account} offers you ${list(data.give)} ${asks}.`, cards: [...captioned(cardsOf(data.give), "offered"), ...captioned(wants, "asked")], target: NotificationTarget.TRADES, tone: "info" });
  },
  "trade.accepted": ({ data, account, list }) => {
    const received = cardsOf(data.received);
    const what = received.length === 0 ? "nothing (a gift)" : list(received);
    return text({ title: "Trade accepted", body: `${account} accepted your offer: you received ${what}.`, cards: captioned(received, "received"), target: NotificationTarget.COLLECTION, tone: "good" });
  },
  "trade.declined": ({ data, account, list }) => {
    const give = cardsOf(data.give);
    return text({ title: "Trade declined", body: `${account} declined your offer; ${list(give)} ${isOne(give) ? "is" : "are"} back in your collection.`, cards: captioned(give, "back to you"), target: NotificationTarget.TRADES, tone: "bad" });
  },
  "trade.cancelled": ({ data, account, list }) => text({ title: "Offer withdrawn", body: `${account} withdrew their offer of ${list(data.give)}.`, cards: cardsOf(data.give), target: NotificationTarget.TRADES, tone: "info" }),
  "trade.expired": ({ data, account, list }) => text({ title: "Trade expired", body: `The offer of ${list(data.give)} between you and ${account} expired.`, cards: cardsOf(data.give), target: NotificationTarget.TRADES, tone: "info" }),
  "sale.sold": ({ data, account, single, singleName }) => text({ title: "Card sold", body: `${account} bought your ${singleName} for ${data.price ?? "?"} ${data.asset ?? ""}.`, cards: only(single), target: NotificationTarget.MARKET, tone: "good" }),
  "sale.bought": ({ account, single, singleName }) => text({ title: "Card received", body: `${singleName} from ${account} is now in your collection.`, cards: only(single), target: NotificationTarget.COLLECTION, tone: "good" }),
  "sale.listing_expired": ({ single, singleName }) => text({ title: "Listing expired", body: `${singleName} was not sold in time and is back in your collection.`, cards: only(single), target: NotificationTarget.MARKET, tone: "info" }),
  "sale.reservation_expired": ({ account, single, singleName }) => text({ title: "Reservation expired", body: `You did not pay ${account} for ${singleName} in time: it is on sale again.`, cards: only(single), target: NotificationTarget.MARKET, tone: "bad" }),
  "sale.payment_problem": ({ account, single, singleName, problem }) => text({ title: "Payment not accepted", body: `Your transfer to ${account} for ${singleName} pays nothing: ${problem}. Ask ${account} to send it back.`, cards: only(single), target: NotificationTarget.MARKET, tone: "bad" }),
});

/**
 * @param {import("../ports/NotificationsApi.contract.js").PlayerNotification} notification
 * @param {{ get: (cardId: string) => { name: string } | undefined }} catalog
 * @returns {NotificationText}
 */
export function describeNotification({ kind, data }, catalog) {
  const describe = DESCRIBERS[kind];
  if (describe === undefined) {
    return text({ title: "Notification", body: "Something happened in your account.", target: null, tone: "info" });
  }
  /** @param {unknown} definitionId */
  const name = (definitionId) => {
    if (typeof definitionId !== "string") {
      return "a card";
    }
    return catalog.get(definitionId)?.name ?? definitionId;
  };
  const single = cardOf(data.card);
  return describe({
    data,
    account: typeof data.account === "string" ? `@${data.account}` : "another player",
    name,
    list: (cards) => cardsSentence(cardsOf(cards), name),
    single,
    singleName: single === null ? "a card" : name(single.definitionId) + serialOf(single),
    problem: PAYMENT_PROBLEMS[/** @type {keyof typeof PAYMENT_PROBLEMS} */ (data.problem)] ?? "it did not match",
  });
}

/**
 * @param {{ title: string, body: string, cards?: readonly NotificationCard[], target: string | null, tone: "good" | "bad" | "info" }} parts
 * @returns {NotificationText}
 */
const text = ({ title, body, cards = [], target, tone }) => Object.freeze({ title, body, cards: Object.freeze([...cards]), target, tone });

/** @param {NotificationCard | null} card */
const only = (card) => (card === null ? [] : [card]);

/** " #12", or "" without a serial. @param {NotificationCard} card */
const serialOf = (card) => (card.serial === undefined ? "" : ` #${card.serial}`);

/** "3× " for several copies, "" for one. @param {unknown} count */
const times = (count) => (typeof count === "number" && count > 1 ? `${count}× ` : "");

/** @param {number} count @param {string} noun */
const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** @param {readonly NotificationCard[]} cards */
const isOne = (cards) => cards.length === 1 && (cards[0].count ?? 1) === 1;

/**
 * @param {unknown} value
 * @returns {NotificationCard[]}
 */
function cardsOf(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((card) => typeof card?.definitionId === "string").map((card) => Object.freeze({ definitionId: card.definitionId, count: Number.isSafeInteger(card.count) ? card.count : 1 }));
}

/**
 * One copy (a sale): its serial, as a caption too.
 * @param {unknown} value
 * @returns {NotificationCard | null}
 */
function cardOf(value) {
  const card = /** @type {any} */ (value);
  if (typeof card?.definitionId !== "string") {
    return null;
  }
  const serial = Number.isSafeInteger(card.serial) ? card.serial : undefined;
  return Object.freeze({ definitionId: card.definitionId, serial, caption: serial === undefined ? "" : `#${serial}` });
}

/**
 * @param {readonly NotificationCard[]} cards
 * @param {string} caption
 */
const captioned = (cards, caption) => cards.map((card) => Object.freeze({ ...card, caption: times(card.count) + caption }));

/**
 * "2× Ember Imp, Iron Watcher and 3 more"; "nothing" when empty.
 * @param {readonly NotificationCard[]} cards
 * @param {(definitionId: string) => string} name
 */
function cardsSentence(cards, name) {
  if (cards.length === 0) {
    return "nothing";
  }
  const named = cards.slice(0, NAMED_CARDS).map((card) => times(card.count) + name(card.definitionId));
  const rest = cards.slice(NAMED_CARDS).reduce((sum, card) => sum + (card.count ?? 1), 0);
  return rest === 0 ? named.join(", ") : `${named.join(", ")} and ${rest} more`;
}
