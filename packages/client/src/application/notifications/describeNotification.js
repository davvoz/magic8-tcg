/**
 * What a notification says (docs/tcg/15-notifiche.md). The server sends a
 * kind and data (ids, accounts, card definition ids); this turns them into
 * a title, a sentence, the cards to show and where the player can follow
 * it up, and the other player it is about (their portrait goes beside it).
 * Pure, so every screen (toasts, the feed) words it the same way.
 */

/** Where a notification leads. */
export const NotificationTarget = Object.freeze({ COLLECTION: "collection", TRADES: "trades", MARKET: "market", SHOP: "shop", ONLINE: "online", REPLAY: "replay" });

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
 * @typedef {Readonly<{ title: string, body: string, cards: readonly NotificationCard[], target: string | null, tone: "good" | "bad" | "info", account?: string, gameId?: string }>} NotificationText
 *   `gameId`: the game a REPLAY target opens
 * @typedef {{ data: Readonly<Record<string, any>>, account: string, name: (definitionId: unknown) => string, list: (cards: unknown) => string, single: NotificationCard | null, singleName: string, problem: string }} Facts
 */

/** @type {Readonly<Record<string, (facts: Facts) => NotificationText>>} */
const DESCRIBERS = Object.freeze({
  "shop.fulfilled": ({ data }) => {
    const cards = cardsOf(data.cards);
    const items = Array.isArray(data.items) ? data.items.map((item) => times(item.quantity) + item.name).join(", ") : "Your order";
    const total = Number.isSafeInteger(data.total) ? data.total : cards.reduce((sum, card) => sum + (card.count ?? 1), 0);
    const entries = Array.isArray(data.entries) ? data.entries.reduce((sum, entry) => sum + (Number.isSafeInteger(entry?.count) ? entry.count : 0), 0) : 0;
    if (entries > 0 && total === 0) {
      return text({ title: "Your ranked entries are ready", body: `${items}: ${plural(entries, "ranked entry", "ranked entries")} to play with, and in the season's jackpot.`, target: NotificationTarget.ONLINE, tone: "good" });
    }
    const andEntries = entries > 0 ? `, and ${plural(entries, "ranked entry", "ranked entries")} to play with` : "";
    return text({ title: "Your cards have arrived", body: `${items}: ${plural(total, "card")} added to your collection${andEntries}.`, cards, target: NotificationTarget.COLLECTION, tone: "good" });
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
  "season.prize": ({ data }) => {
    const place = ["1st", "2nd", "3rd"][Number(data.place) - 1] ?? `#${data.place ?? "?"}`;
    return text({ title: `You finished ${place} in ${data.season ?? "the season"}!`, body: `Your share of the jackpot, ${data.amount ?? "?"} ${data.asset ?? ""}, will be sent to your wallet.`, target: null, tone: "good" });
  },
  "auto.finished": ({ data }) => {
    const opponent = typeof data.opponent === "string" ? `@${data.opponent}` : "another player";
    const outcome = AUTO_OUTCOMES[/** @type {keyof typeof AUTO_OUTCOMES} */ (data.result)] ?? AUTO_OUTCOMES.draw;
    const styles = `Your deck played ${styleName(data.style)}, ${opponent}'s ${styleName(data.opponentStyle)}.`;
    const rating = Number.isFinite(data.rating?.before) && Number.isFinite(data.rating?.after) ? ` Rating ${data.rating.before} → ${data.rating.after}.` : "";
    const played = text({ title: `Auto game vs ${opponent}: ${outcome.title}`, body: `${styles}${rating} Watch the game.`, target: NotificationTarget.REPLAY, tone: outcome.tone });
    return typeof data.gameId === "string" ? Object.freeze({ ...played, gameId: data.gameId }) : played;
  },
  "auto.refunded": ({ data }) => {
    const why = data.reason === "season_ended" ? "The season ended before anyone joined the auto list against you" : "Your auto game could not be played";
    return text({ title: "Your ranked entry is back", body: `${why}: your ranked entry is back, ready for another game.`, target: NotificationTarget.ONLINE, tone: "info" });
  },
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
  const described = describe({
    data,
    account: typeof data.account === "string" ? `@${data.account}` : "another player",
    name,
    list: (cards) => cardsSentence(cardsOf(cards), name),
    single,
    singleName: single === null ? "a card" : name(single.definitionId) + serialOf(single),
    problem: PAYMENT_PROBLEMS[/** @type {keyof typeof PAYMENT_PROBLEMS} */ (data.problem)] ?? "it did not match",
  });
  return typeof data.account === "string" ? Object.freeze({ ...described, account: data.account }) : described;
}

/** How an auto game went for the player. */
const AUTO_OUTCOMES = Object.freeze({
  win: Object.freeze({ title: "you won", tone: /** @type {const} */ ("good") }),
  loss: Object.freeze({ title: "you lost", tone: /** @type {const} */ ("bad") }),
  draw: Object.freeze({ title: "a draw", tone: /** @type {const} */ ("info") }),
});

/** "Aggressive": an AI style as the player chose it. @param {unknown} style */
const styleName = (style) => (typeof style === "string" && style.length > 0 ? style[0].toUpperCase() + style.slice(1) : "its own way");

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

/**
 * "1 card", "3 cards"; `many` for an irregular plural ("ranked entries").
 * @param {number} count
 * @param {string} noun
 * @param {string} [many]
 */
const plural = (count, noun, many = `${noun}s`) => `${count} ${count === 1 ? noun : many}`;

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
