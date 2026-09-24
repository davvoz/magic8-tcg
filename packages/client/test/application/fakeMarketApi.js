/**
 * A scripted marketplace server for shop tests. Orders move to the next
 * status in `progression` each time they are read, ending FULFILLED with the
 * given cards; `fail` makes the next call to a method fail.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";

export const LISTING = Object.freeze({
  products: [
    { id: "core_booster", kind: "booster", name: "Core Booster", description: "5 cards.", prices: [{ asset: "STEEM", amount: "1.000" }], contents: [{ type: "pack", ref: "core_booster", count: 1, finish: null }], cards: 5, perOrder: 20 },
    { id: "core_booster_box", kind: "bundle", name: "Core Booster Box", description: "12 boosters.", prices: [{ asset: "STEEM", amount: "10.000" }], contents: [{ type: "product", ref: "core_booster", count: 12, finish: null }], cards: 60, perOrder: 5 },
    { id: "single_pyre_drake_foil", kind: "single", name: "Pyre Drake (foil)", description: "One foil Pyre Drake.", prices: [{ asset: "STEEM", amount: "2.500" }], contents: [{ type: "card", ref: "pyre_drake", count: 1, finish: "foil" }], cards: 1, perOrder: 1 },
  ],
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
      payment: status === "PAYMENT_PENDING" ? { network: "steem", from: "alice", to: "luciojolly", asset: "STEEM", amount: `${entry.quantity}.000`, memo: `m8tcg-${"a".repeat(26)}`, expiresAt: 1 } : null,
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
