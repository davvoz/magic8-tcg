/**
 * A scripted marketplace server for shop tests. Orders move to the next
 * status in `progression` each time they are read, ending FULFILLED with the
 * given cards (or, for an order of ranked entries alone, those entries);
 * `fail` makes the next call to a method fail.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fail, ok } from "@magic8/engine/shared/Result.js";

const DATA = resolve(import.meta.dirname, "../../../../data");
const readData = (path) => JSON.parse(readFileSync(resolve(DATA, path), "utf8"));
/** An amount as the server formats it: STEEM's three decimals ("2.5" → "2.500"). @param {string} amount */
const steem = (amount) => Number(amount).toFixed(3);
/** The server's price list (data/economy/pricing.json), as the listing publishes it. */
const PRICE_LIST = Object.freeze({
  asset: "STEEM",
  singles: Object.entries(readData("economy/pricing.json").singles.prices).map(([rarity, price]) => Object.freeze({ rarity, price: steem(price) })),
});
const RARITY_OF = readData("economy/rarities.json").cards;

const product = ({ id, kind, name, amount, contents, rarity = null, cards = 1, perOrder = 3, description = `${name}.` }) =>
  Object.freeze({ id, kind, name, description, prices: [{ asset: "STEEM", amount }], contents, rarity, cards, perOrder });
/** The single of a card, priced by its rarity like the server does. */
const single = (cardId, name) => {
  const rarity = RARITY_OF[cardId];
  const { price } = PRICE_LIST.singles.find((entry) => entry.rarity === rarity);
  return product({ id: `single_${cardId}`, kind: "single", name, amount: price, contents: [{ type: "card", ref: cardId, count: 1 }], rarity });
};

export const LISTING = Object.freeze({
  products: [
    product({ id: "core_booster", kind: "pack", name: "Core Booster", amount: "1.000", contents: [{ type: "pack", ref: "core_booster", count: 1 }], cards: 5, perOrder: 20, description: "5 unknown cards." }),
    product({ id: "core_mini_booster", kind: "pack", name: "Core Mini Booster", amount: "0.500", contents: [{ type: "pack", ref: "core_mini_booster", count: 1 }], cards: 3, perOrder: 20, description: "3 unknown cards." }),
    // 49.000: the sum of its 30 cards as singles, as the server prices it.
    product({ id: "deck_precon_arcane", kind: "deck", name: "Arcane Conclave", amount: "49.000", contents: [{ type: "deck", ref: "precon_arcane", count: 1 }], cards: 30 }),
    product({ id: "core_booster_box", kind: "bundle", name: "Core Booster Box", amount: "10.000", contents: [{ type: "product", ref: "core_booster", count: 12 }], cards: 60, perOrder: 5, description: "12 boosters." }),
    // Every card, as the server sells them (named by id, except the one the tests look at).
    ...Object.keys(RARITY_OF).map((cardId) => single(cardId, cardId === "pyre_drake" ? "Pyre Drake" : cardId)),
  ],
  rarities: ["common", "uncommon", "rare", "epic", "legendary"],
  priceList: PRICE_LIST,
  dropTables: [
    {
      id: "core_booster",
      hash: "ab".repeat(32),
      size: 5,
      slots: [
        { count: 3, odds: { common: { numerator: 1, denominator: 1 } } },
        { count: 1, odds: { uncommon: { numerator: 1, denominator: 1 } } },
        { count: 1, odds: { epic: { numerator: 10, denominator: 100 }, legendary: { numerator: 2, denominator: 100 }, rare: { numerator: 88, denominator: 100 } } },
      ],
    },
    {
      id: "core_mini_booster",
      hash: "cd".repeat(32),
      size: 3,
      slots: [
        { count: 2, odds: { common: { numerator: 1, denominator: 1 } } },
        { count: 1, odds: { uncommon: { numerator: 80, denominator: 100 }, rare: { numerator: 16, denominator: 100 }, epic: { numerator: 3, denominator: 100 }, legendary: { numerator: 1, denominator: 100 } } },
      ],
    },
  ],
});

/** Ranked entries, as the server sells them (data/economy/products/ranked_entry.json): no card, one ranked game each. */
export const RANKED_ENTRY_PRODUCT = product({ id: "ranked_entry", kind: "entry", name: "Ranked Entry", amount: "1.000", contents: [{ type: "entry", ref: "ranked", count: 1 }], cards: 0, perOrder: 50, description: "One ranked game." });
/** The listing with ranked entries on sale too. */
export const LISTING_WITH_ENTRIES = Object.freeze({ ...LISTING, products: [...LISTING.products, RANKED_ENTRY_PRODUCT] });

const card = (index, definitionId) => Object.freeze({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, definitionId, edition: "core-1", serial: index + 1 });
export const PACK_CARDS = Object.freeze(["ember_imp", "grave_rat", "moss_beetle", "iron_watcher", "pyre_drake"].map((id, index) => card(index, id)));

export function fakeMarketApi({ progression = ["PAYMENT_DETECTED", "PAYMENT_VERIFIED", "FULFILLED"], listing = LISTING } = {}) {
  const calls = [];
  const failures = new Map();
  let orders = 0;
  const state = new Map();
  const view = (entry) => {
    const status = entry.statuses[Math.min(entry.step, entry.statuses.length - 1)];
    const quantity = entry.items.reduce((sum, item) => sum + item.quantity, 0);
    return Object.freeze({
      id: entry.id,
      status,
      items: entry.items.map((item) => ({ productId: item.productId, name: item.productId, quantity: item.quantity, unitAmount: "1.000" })),
      total: { asset: "STEEM", amount: `${quantity}.000` },
      payment: status === "PAYMENT_PENDING" ? { network: "steem", from: "alice", to: "verdu.green", asset: "STEEM", amount: `${quantity}.000`, memo: `m8tcg-${"a".repeat(26)}`, expiresAt: 1 } : null,
      failureReason: null,
      createdAt: 0,
      fulfilment: status === "FULFILLED" ? fulfilmentOf(entry.items) : null,
    });
  };
  const method = (name, handler) => async (...args) => {
    calls.push({ name, args });
    const failure = failures.get(name);
    if (failure !== undefined) {
      failures.delete(name);
      return fail(failure, failure);
    }
    return handler(...args);
  };
  const api = {
    listing: method("listing", () => ok(listing)),
    createOrder: method("createOrder", ({ items }) => {
      orders += 1;
      const entry = { id: `00000000-0000-4000-8000-${String(orders).padStart(12, "0")}`, items: items.map((item) => ({ ...item })), statuses: ["PAYMENT_PENDING"], step: 0 };
      state.set(entry.id, entry);
      return ok(view(entry));
    }),
    getOrder: method("getOrder", (id) => {
      const entry = state.get(id);
      entry.step += 1;
      return ok(view(entry));
    }),
    listOrders: method("listOrders", () => ok([...state.values()].map(view))),
    cancelOrder: method("cancelOrder", (id) => {
      const entry = state.get(id);
      entry.statuses = ["CANCELLED"];
      entry.step = 0;
      return ok(view(entry));
    }),
    paymentHint: method("paymentHint", (id) => {
      const entry = state.get(id);
      entry.statuses = ["PAYMENT_PENDING", ...progression];
      return ok(view(entry));
    }),
  };
  return { api, calls, orders: state, fail: (name, code) => failures.set(name, code) };
}

/**
 * What an order gave: ranked entries for an order of them alone, else a pack of cards.
 * @param {readonly { productId: string, quantity: number }[]} items
 */
function fulfilmentOf(items) {
  const entries = items.filter((item) => item.productId === RANKED_ENTRY_PRODUCT.id).reduce((sum, item) => sum + item.quantity, 0);
  if (entries > 0 && entries === items.reduce((sum, item) => sum + item.quantity, 0)) {
    return { txId: "cd".repeat(20), cards: [], packs: [], entries: [{ kind: "ranked", count: entries }] };
  }
  return { txId: "cd".repeat(20), cards: [], packs: [{ index: 0, cards: PACK_CARDS }], entries: entries > 0 ? [{ kind: "ranked", count: entries }] : [] };
}
