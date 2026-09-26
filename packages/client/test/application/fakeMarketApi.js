/**
 * A scripted marketplace server for shop tests. Orders move to the next
 * status in `progression` each time they are read, ending FULFILLED with the
 * given cards; `fail` makes the next call to a method fail.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fail, ok } from "@magic8/engine/shared/Result.js";

const DATA = resolve(import.meta.dirname, "../../../../data");
const readData = (path) => JSON.parse(readFileSync(resolve(DATA, path), "utf8"));
/** The server's price list (data/economy/pricing.json), as the listing publishes it. */
const PRICE_LIST = Object.freeze({
  asset: "STEEM",
  singles: Object.entries(readData("economy/pricing.json").singles.prices).map(([rarity, price]) => Object.freeze({ rarity, standard: price.standard, foil: price.foil ?? null })),
});
const RARITY_OF = readData("economy/rarities.json").cards;
const ARCANE = readData("decks/precon_arcane.deck.json");

const product = ({ id, kind, name, amount, contents, rarity = null, cards = 1, perOrder = 3, description = `${name}.` }) =>
  Object.freeze({ id, kind, name, description, prices: [{ asset: "STEEM", amount }], contents, rarity, cards, perOrder });
/** Standard and foil singles of a card, priced by its rarity like the server does. */
const singles = (cardId, name) => {
  const rarity = RARITY_OF[cardId];
  const price = PRICE_LIST.singles.find((entry) => entry.rarity === rarity);
  return [
    product({ id: `single_${cardId}`, kind: "single", name, amount: price.standard, contents: [{ type: "card", ref: cardId, count: 1, finish: null }], rarity }),
    product({ id: `single_${cardId}_foil`, kind: "single", name: `${name} (foil)`, amount: price.foil, contents: [{ type: "card", ref: cardId, count: 1, finish: "foil" }], rarity }),
  ];
};

export const LISTING = Object.freeze({
  products: [
    product({ id: "core_booster", kind: "pack", name: "Core Booster", amount: "1.000", contents: [{ type: "pack", ref: "core_booster", count: 1, finish: null }], cards: 5, perOrder: 20, description: "5 unknown cards." }),
    product({ id: "core_mini_booster", kind: "pack", name: "Core Mini Booster", amount: "0.500", contents: [{ type: "pack", ref: "core_mini_booster", count: 1, finish: null }], cards: 3, perOrder: 20, description: "3 unknown cards." }),
    // 10.750: the sum of its 30 cards as singles, as the server prices it.
    product({ id: "deck_precon_arcane", kind: "deck", name: "Arcane Conclave", amount: "10.750", contents: [{ type: "deck", ref: "precon_arcane", count: 1, finish: null }], cards: 30 }),
    product({ id: "core_booster_box", kind: "bundle", name: "Core Booster Box", amount: "10.000", contents: [{ type: "product", ref: "core_booster", count: 12, finish: null }], cards: 60, perOrder: 5, description: "12 boosters." }),
    ...singles("pyre_drake", "Pyre Drake"),
    ...ARCANE.cards.flatMap((entry) => singles(entry.cardId, entry.cardId)),
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
      foil: { numerator: 1, denominator: 20 },
    },
    {
      id: "core_mini_booster",
      hash: "cd".repeat(32),
      size: 3,
      slots: [
        { count: 2, odds: { common: { numerator: 1, denominator: 1 } } },
        { count: 1, odds: { uncommon: { numerator: 80, denominator: 100 }, rare: { numerator: 16, denominator: 100 }, epic: { numerator: 3, denominator: 100 }, legendary: { numerator: 1, denominator: 100 } } },
      ],
      foil: { numerator: 1, denominator: 20 },
    },
  ],
});

const card = (index, definitionId, finish = "standard") => Object.freeze({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, definitionId, edition: "core-1", serial: index + 1, finish });
export const PACK_CARDS = Object.freeze(["ember_imp", "grave_rat", "moss_beetle", "iron_watcher", "pyre_drake"].map((id, index) => card(index, id, index === 4 ? "foil" : "standard")));

export function fakeMarketApi({ progression = ["PAYMENT_DETECTED", "PAYMENT_VERIFIED", "FULFILLED"] } = {}) {
  const calls = [];
  const failures = new Map();
  let orders = 0;
  const state = new Map();
  const view = (entry) => {
    const status = entry.statuses[Math.min(entry.step, entry.statuses.length - 1)];
    return Object.freeze({
      id: entry.id,
      status,
      items: [{ productId: entry.productId, name: entry.productId, quantity: entry.quantity, unitAmount: "1.000" }],
      total: { asset: "STEEM", amount: `${entry.quantity}.000` },
      payment: status === "PAYMENT_PENDING" ? { network: "steem", from: "alice", to: "verdu.green", asset: "STEEM", amount: `${entry.quantity}.000`, memo: `m8tcg-${"a".repeat(26)}`, expiresAt: 1 } : null,
      failureReason: null,
      createdAt: 0,
      fulfilment: status === "FULFILLED" ? { txId: "cd".repeat(20), cards: [], packs: [{ index: 0, cards: PACK_CARDS }] } : null,
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
    listing: method("listing", () => ok(LISTING)),
    createOrder: method("createOrder", ({ productId, quantity }) => {
      orders += 1;
      const entry = { id: `00000000-0000-4000-8000-${String(orders).padStart(12, "0")}`, productId, quantity, statuses: ["PAYMENT_PENDING"], step: 0 };
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
