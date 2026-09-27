import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { MAX_CART_LINES, PurchaseStage, ShopError, ShopService, ShopStatus } from "../../src/application/shop/ShopService.js";
import { ALICE, BOB, accountWorld, settle } from "./accountWorld.js";
import { fakeMarketApi } from "./fakeMarketApi.js";
import { loadBundledContent } from "./fixtures.js";

const TX = "ef".repeat(20);
const content = await loadBundledContent();

/** @param {ConstructorParameters<typeof ShopService>[0]["account"]} account */
function shopFor(account) {
  const market = fakeMarketApi();
  const wallet = { name: "Steem Keychain", isAvailable: () => true, signMessage: async () => fail("X", "x"), requestTransfer: async () => ok(TX) };
  return { market, shop: new ShopService({ api: market.api, wallet, account, scheduler: { delay: async () => undefined }, newKey: () => "key-000000000000001" }) };
}

function world({ account = "alice", transfer = async () => ok(TX), ...options } = {}) {
  const market = fakeMarketApi(options);
  const transfers = [];
  const refreshes = [];
  const wallet = { name: "Steem Keychain", isAvailable: () => true, signMessage: async () => fail("X", "x"), requestTransfer: async (request) => (transfers.push(request), transfer(request)) };
  const accountService = { state: { account }, refresh: async () => refreshes.push(true) };
  let keys = 0;
  const shop = new ShopService({ api: market.api, wallet, account: accountService, scheduler: { delay: async () => undefined }, newKey: () => `key-${String((keys += 1)).padStart(12, "0")}`, maxPolls: 10 });
  return { shop, market, transfers, refreshes, accountService };
}

describe("ShopService", () => {
  it("loads the listing, signed out too", async () => {
    const { shop } = world({ account: null });
    assert.equal(shop.state.status, ShopStatus.IDLE);
    await shop.load();
    assert.equal(shop.state.status, ShopStatus.READY);
    assert.equal(shop.state.listing.products[0].id, "core_booster");
    assert.equal((await shop.buy({ productId: "core_booster", quantity: 1, asset: "STEEM" })).error.code, ShopError.SIGNED_OUT);
  });

  it("buys: order, the server's exact transfer in the wallet, a hint, then waits for the cards", async () => {
    const { shop, market, transfers, refreshes } = world();
    await shop.load();
    const stages = [];
    shop.subscribe((state) => stages.push(state.purchase.stage));
    const bought = await shop.buy({ productId: "core_booster", quantity: 2, asset: "STEEM" });
    assert.equal(bought.ok, true, JSON.stringify(bought));
    const created = market.calls.find((call) => call.name === "createOrder");
    assert.deepEqual(created.args[0], { items: [{ productId: "core_booster", quantity: 2 }], asset: "STEEM" });
    assert.match(created.args[1], /^key-/);
    assert.deepEqual(transfers, [{ from: "alice", to: "verdu.green", amount: "2.000", asset: "STEEM", memo: `m8tcg-${"a".repeat(26)}` }], "exactly the server's instructions");
    assert.deepEqual(market.calls.find((call) => call.name === "paymentHint").args.slice(1), [TX]);
    assert.equal(shop.state.purchase.stage, PurchaseStage.DONE);
    assert.equal(shop.state.purchase.txId, TX);
    assert.equal(shop.state.purchase.order.fulfilment.packs[0].cards.length, 5);
    assert.equal(refreshes.length, 1, "the collection reloads");
    for (const stage of [PurchaseStage.ORDERING, PurchaseStage.SIGNING, PurchaseStage.CONFIRMING, PurchaseStage.DONE]) {
      assert.ok(stages.includes(stage), stage);
    }
    shop.dismiss();
    assert.equal(shop.state.purchase.stage, PurchaseStage.NONE);
  });

  it("keeps an order payable after the wallet refuses: pay again, or cancel", async () => {
    let refuse = true;
    const { shop, market } = world({ transfer: async () => (refuse ? fail("WALLET_REJECTED", "cancelled") : ok(TX)) });
    await shop.load();
    const refused = await shop.buy({ productId: "core_booster", quantity: 1, asset: "STEEM" });
    assert.equal(refused.error.code, "WALLET_REJECTED");
    assert.equal(shop.state.purchase.stage, PurchaseStage.FAILED);
    assert.ok(shop.state.purchase.order.payment, "still payable");
    refuse = false;
    assert.equal((await shop.payAgain()).ok, true);
    assert.equal(shop.state.purchase.stage, PurchaseStage.DONE);

    refuse = true;
    await shop.buy({ productId: "core_booster", quantity: 1, asset: "STEEM" });
    const id = shop.state.purchase.order.id;
    assert.equal((await shop.cancel()).ok, true);
    assert.equal(market.orders.get(id).statuses[0], "CANCELLED");
    assert.equal(shop.state.purchase.stage, PurchaseStage.NONE);
  });

  it("reports a refused order, an order that ends badly, and a slow chain", async () => {
    const refusedOrder = world();
    await refusedOrder.shop.load();
    refusedOrder.market.fail("createOrder", "LIMIT_REACHED");
    assert.equal((await refusedOrder.shop.buy({ productId: "core_booster", quantity: 1, asset: "STEEM" })).error.code, "LIMIT_REACHED");
    assert.equal(refusedOrder.shop.state.purchase.stage, PurchaseStage.FAILED);

    const expired = world({ progression: ["EXPIRED"] });
    await expired.shop.load();
    assert.equal((await expired.shop.buy({ productId: "core_booster", quantity: 1, asset: "STEEM" })).error.code, "EXPIRED");

    const slow = world({ progression: ["PAYMENT_DETECTED"] });
    await slow.shop.load();
    const waited = await slow.shop.buy({ productId: "core_booster", quantity: 1, asset: "STEEM" });
    assert.equal(waited.error.code, ShopError.STILL_WAITING);
    assert.equal(slow.shop.state.purchase.stage, PurchaseStage.CONFIRMING, "not a failure: the cards will come");
    assert.equal(slow.refreshes.length, 0);
  });

  it("fills a cart: adds up copies, caps them at the per-order limit, changes and removes lines", async () => {
    const { shop } = world();
    await shop.load();
    assert.equal(shop.addToCart("core_booster", 2).ok, true);
    assert.equal(shop.addToCart("single_pyre_drake", 1).ok, true);
    assert.equal(shop.addToCart("core_booster", 3).ok, true);
    assert.deepEqual(shop.state.cart, [{ productId: "core_booster", quantity: 5 }, { productId: "single_pyre_drake", quantity: 1 }], "same product, one line");
    const capped = shop.addToCart("single_pyre_drake", 5);
    assert.equal(capped.error.code, ShopError.CART);
    assert.equal(shop.state.cart[1].quantity, 3, "the product's per-order limit");
    assert.equal(shop.addToCart("nope", 1).error.code, ShopError.CART);
    shop.setCartQuantity("core_booster", 1);
    shop.setCartQuantity("single_pyre_drake", 99);
    assert.deepEqual(shop.state.cart, [{ productId: "core_booster", quantity: 1 }, { productId: "single_pyre_drake", quantity: 3 }]);
    shop.removeFromCart("core_booster");
    assert.deepEqual(shop.state.cart, [{ productId: "single_pyre_drake", quantity: 3 }]);
    shop.clearCart();
    assert.deepEqual(shop.state.cart, []);
    const singles = shop.state.listing.products.filter((product) => product.kind === "single").slice(0, MAX_CART_LINES + 1);
    const added = singles.map((product) => shop.addToCart(product.id, 1).ok);
    assert.deepEqual([added.filter(Boolean).length, added.at(-1)], [MAX_CART_LINES, false], "at most 20 different products");
  });

  it("checks the cart out as one order with one transfer, and empties it", async () => {
    const { shop, market, transfers } = world();
    await shop.load();
    shop.addToCart("core_booster", 2);
    shop.addToCart("single_pyre_drake", 1);
    const paid = await shop.checkout("STEEM");
    assert.equal(paid.ok, true, JSON.stringify(paid));
    const created = market.calls.filter((call) => call.name === "createOrder");
    assert.equal(created.length, 1);
    assert.deepEqual(created[0].args[0], { items: [{ productId: "core_booster", quantity: 2 }, { productId: "single_pyre_drake", quantity: 1 }], asset: "STEEM" });
    assert.equal(transfers.length, 1, "one payment for the whole cart");
    assert.equal(transfers[0].amount, "3.000");
    assert.equal(shop.state.purchase.stage, PurchaseStage.DONE);
    assert.deepEqual(shop.state.cart, []);
    assert.equal((await shop.checkout("STEEM")).error.code, ShopError.CART, "nothing left to pay for");
  });

  it("empties the cart only once the payment is sent, keeping what was added meanwhile", async () => {
    let refuse = true;
    const { shop, market } = world({ transfer: async () => (refuse ? fail("WALLET_REJECTED", "cancelled") : ok(TX)) });
    await shop.load();
    shop.addToCart("core_booster", 2);
    market.fail("createOrder", "LIMIT_REACHED");
    assert.equal((await shop.checkout("STEEM")).error.code, "LIMIT_REACHED");
    assert.deepEqual(shop.state.cart, [{ productId: "core_booster", quantity: 2 }], "no order, the cart stays");
    assert.equal((await shop.checkout("STEEM")).error.code, "WALLET_REJECTED");
    assert.deepEqual(shop.state.cart, [{ productId: "core_booster", quantity: 2 }], "not paid, the cart stays");
    assert.equal((await shop.cancel()).ok, true);
    assert.deepEqual(shop.state.cart, [{ productId: "core_booster", quantity: 2 }], "cancelled, the cart stays");

    await shop.checkout("STEEM");
    shop.addToCart("core_booster", 1);
    shop.addToCart("single_pyre_drake", 1);
    refuse = false;
    assert.equal((await shop.payAgain()).ok, true);
    assert.deepEqual(shop.state.cart, [{ productId: "core_booster", quantity: 1 }, { productId: "single_pyre_drake", quantity: 1 }], "the paid copies leave, the ones added meanwhile stay");
  });

  it("empties the cart when the player signs out or someone else signs in, not when a guest signs in", async () => {
    const people = accountWorld(content);
    const { shop } = shopFor(people.account);
    await shop.load();
    shop.addToCart("core_booster", 1);
    people.identity.become(ALICE);
    await settle();
    assert.deepEqual(shop.state.cart, [{ productId: "core_booster", quantity: 1 }], "a guest's cart is kept on sign-in");
    people.identity.become(BOB);
    await settle();
    assert.deepEqual(shop.state.cart, [], "someone else's cart is not shown");
    shop.addToCart("core_booster", 1);
    people.identity.become(null);
    await settle();
    assert.deepEqual(shop.state.cart, [], "signing out empties it");
  });

  it("allows one purchase at a time", async () => {
    let release;
    const { shop } = world({ transfer: () => new Promise((resolve) => (release = () => resolve(ok(TX)))) });
    await shop.load();
    const first = shop.buy({ productId: "core_booster", quantity: 1, asset: "STEEM" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal((await shop.buy({ productId: "core_booster", quantity: 1, asset: "STEEM" })).error.code, ShopError.BUSY);
    release();
    assert.equal((await first).ok, true);
  });
});
