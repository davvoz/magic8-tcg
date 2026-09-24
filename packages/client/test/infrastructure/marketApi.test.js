/**
 * HttpMarketApi (requests and response checks) and Keychain transfers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpMarketApi } from "../../src/infrastructure/api/HttpMarketApi.js";
import { KeychainWalletConnector } from "../../src/infrastructure/wallet/KeychainWalletConnector.js";

const ORDER_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TX = "ab".repeat(20);
const ORDER = Object.freeze({
  id: ORDER_ID,
  status: "PAYMENT_PENDING",
  items: [{ productId: "core_booster", name: "Core Booster", quantity: 1, unitAmount: "1.000" }],
  total: { asset: "STEEM", amount: "1.000" },
  payment: { network: "steem", from: "alice", to: "luciojolly", asset: "STEEM", amount: "1.000", memo: "m8tcg-x", expiresAt: 5 },
  rngEpochId: 1,
  failureReason: null,
  createdAt: 1,
  updatedAt: 1,
  fulfilment: null,
});
const LISTING = Object.freeze({
  products: [{ id: "core_booster", kind: "booster", name: "Core Booster", description: "d", prices: [{ asset: "STEEM", amount: "1.000" }], contents: [{ type: "pack", ref: "core_booster", count: 1, finish: null }], cards: 5, limits: { perOrder: 20, availableFrom: null, availableUntil: null } }],
  dropTables: [{ id: "core_booster", hash: "cd".repeat(32), edition: "core-1", size: 5, odds: [{ count: 5, odds: { common: { numerator: 1, denominator: 1 } } }], foil: { numerator: 1, denominator: 20 }, pools: { common: ["ember_imp"] } }],
  rarities: ["common"],
});

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** @param {(url: string, init: any) => Response | Promise<Response>} handler */
function apiWith(handler) {
  const requests = [];
  const api = new HttpMarketApi({ fetch: async (url, init) => (requests.push({ url, init }), handler(url, init)) });
  return { api, requests };
}

describe("HttpMarketApi", () => {
  it("reads the listing", async () => {
    const listing = await apiWith(() => json(200, LISTING)).api.listing();
    assert.equal(listing.value.products[0].perOrder, 20);
    assert.deepEqual(listing.value.dropTables[0].slots, [{ count: 5, odds: { common: { numerator: 1, denominator: 1 } } }]);
  });

  it("creates orders with the Idempotency-Key and never sends a price", async () => {
    const { api, requests } = apiWith(() => json(201, { order: ORDER }));
    const created = await api.createOrder({ productId: "core_booster", quantity: 1, asset: "STEEM" }, "key-0000000000001");
    assert.equal(created.value.payment.memo, "m8tcg-x");
    assert.equal(requests[0].url, "/api/orders");
    assert.equal(requests[0].init.headers["Idempotency-Key"], "key-0000000000001");
    assert.equal(requests[0].init.headers["X-M8-Request"], "1");
    assert.equal(requests[0].init.body, JSON.stringify({ productId: "core_booster", quantity: 1, asset: "STEEM" }));
  });

  it("reads, cancels and hints orders by id, never with a non-UUID in the path", async () => {
    const { api, requests } = apiWith(() => json(200, { order: ORDER }));
    await api.getOrder(ORDER_ID);
    await api.cancelOrder(ORDER_ID);
    await api.paymentHint(ORDER_ID, TX);
    assert.deepEqual(requests.map(({ url, init }) => `${init.method} ${url}`), [`GET /api/orders/${ORDER_ID}`, `POST /api/orders/${ORDER_ID}/cancel`, `POST /api/orders/${ORDER_ID}/payment-hint`]);
    assert.equal(requests[2].init.body, JSON.stringify({ txId: TX }));
    assert.equal((await api.getOrder("../admin")).error.code, "BAD_RESPONSE");
    assert.equal(requests.length, 3);
  });

  it("refuses unexpected shapes", async () => {
    const bad = [
      { ...ORDER, id: "1" },
      { ...ORDER, payment: { ...ORDER.payment, amount: 1 } },
      { ...ORDER, total: { asset: "STEEM", amount: "1" } },
      { ...ORDER, fulfilment: { txId: "x", cards: [], packs: [] } },
      { ...ORDER, fulfilment: { txId: TX, cards: [{ id: "nope" }], packs: [] } },
    ];
    for (const order of bad) {
      assert.equal((await apiWith(() => json(200, { order })).api.getOrder(ORDER_ID)).error.code, "BAD_RESPONSE", JSON.stringify(order));
    }
    assert.equal((await apiWith(() => json(200, { products: [{ id: 1 }], dropTables: [] })).api.listing()).error.code, "BAD_RESPONSE");
    const conflict = await apiWith(() => json(409, { error: { code: "LIMIT_REACHED", message: "too many" } })).api.createOrder({ productId: "x", quantity: 1, asset: "STEEM" }, "key-0000000000002");
    assert.equal(conflict.error.code, "LIMIT_REACHED");
  });
});

const realTimers = { setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: (id) => clearTimeout(id) };

/** A Keychain fake with both methods; `respond` answers transfers. */
function keychainWith(respond) {
  const transfers = [];
  return {
    transfers,
    keychain: {
      requestSignBuffer: () => undefined,
      requestTransfer: (...args) => {
        transfers.push(args.slice(0, 5).concat([args[6]]));
        respond(args[5]);
      },
    },
  };
}

describe("KeychainWalletConnector transfers", () => {
  const REQUEST = Object.freeze({ from: "alice", to: "luciojolly", amount: "1.000", asset: "STEEM", memo: "m8tcg-x" });

  it("asks for exactly the instructed transfer, from the buyer's account only", async () => {
    const { keychain, transfers } = keychainWith((callback) => callback({ success: true, result: { id: TX, block_num: 1 } }));
    const connector = new KeychainWalletConnector({ locate: () => keychain, timers: realTimers });
    assert.deepEqual(await connector.requestTransfer(REQUEST), { ok: true, value: TX });
    assert.deepEqual(transfers, [["alice", "luciojolly", "1.000", "m8tcg-x", "STEEM", true]], "enforce: Keychain may not switch account");
  });

  it("maps refusals, odd results and a missing transfer method to failures", async () => {
    const cancelled = new KeychainWalletConnector({ locate: () => keychainWith((callback) => callback({ success: false, message: "user cancel" })).keychain, timers: realTimers });
    assert.equal((await cancelled.requestTransfer(REQUEST)).error.code, "WALLET_REJECTED");
    const odd = new KeychainWalletConnector({ locate: () => keychainWith((callback) => callback({ success: true, result: { id: "nope" } })).keychain, timers: realTimers });
    assert.equal((await odd.requestTransfer(REQUEST)).error.code, "WALLET_BAD_RESPONSE");
    const old = new KeychainWalletConnector({ locate: () => ({ requestSignBuffer: () => undefined }), timers: realTimers });
    assert.equal((await old.requestTransfer(REQUEST)).error.code, "WALLET_NOT_INSTALLED");
    const { keychain, transfers } = keychainWith(() => undefined);
    const badAmount = new KeychainWalletConnector({ locate: () => keychain, timers: realTimers });
    assert.equal((await badAmount.requestTransfer({ ...REQUEST, amount: "1" })).error.code, "WALLET_BAD_RESPONSE");
    assert.equal(transfers.length, 0, "never asked");
  });
});
