/**
 * The player market on the client (docs/tcg/14): the HTTP adapter checks
 * every answer; the service loads the board, sells, and buys by forwarding
 * the server's payment instructions (to the seller) to the wallet, then
 * polls until the card arrives; the screen shows the board, the right
 * action for each listing, the purchase in progress and the sell composer.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { BuyStage, SalesService } from "../../src/application/sales/SalesService.js";
import { HttpSalesApi } from "../../src/infrastructure/api/HttpSalesApi.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { immediateScheduler } from "../../src/infrastructure/time/ImmediateScheduler.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { MarketScene, listingSubtitle } from "../../src/rendering/scenes/MarketScene.js";
import { FakeContext2D, loadTheme } from "../rendering/fakes.js";
import { loadBundledContent } from "./fixtures.js";

const theme = loadTheme();
const content = await loadBundledContent();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const NOW = 1_790_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CARD = Object.freeze({ id: uuid(11), definitionId: "ember_imp", edition: "core-1", serial: 4 });
const LISTING = Object.freeze({ id: uuid(1), status: "ACTIVE", seller: "alice", card: CARD, price: { asset: "STEEM", amount: "1.500" }, reserved: false, buyer: null, createdAt: NOW, expiresAt: NOW + 2 * DAY + 1, closedAt: null });
const MEMO = `m8sale-${"a".repeat(26)}`;
const PURCHASE = Object.freeze({
  id: uuid(2),
  listingId: LISTING.id,
  status: "PENDING",
  seller: "alice",
  card: CARD,
  price: LISTING.price,
  payment: { network: "steem", from: "bob", to: "alice", asset: "STEEM", amount: "1.500", memo: MEMO, expiresAt: NOW + 15 * 60 * 1000 },
  txId: null,
  problem: null,
  createdAt: NOW,
  expiresAt: NOW + 15 * 60 * 1000,
  closedAt: null,
});
const TX_ID = "ab".repeat(20);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("HttpSalesApi", () => {
  it("reads the board and purchases, sends the idempotency key, and refuses malformed answers", async () => {
    const requests = [];
    let answer = { listings: [LISTING], total: 1, offset: 0, pageSize: 50 };
    const api = new HttpSalesApi({ fetch: async (url, init) => (requests.push({ url, init }), json(200, answer)) });
    assert.deepEqual((await api.board({ card: "ember_imp", sort: "cheapest" })).value.listings, [LISTING]);
    assert.match(requests.at(-1).url, /\/api\/listings\?card=ember_imp&sort=cheapest$/);
    answer = { listing: LISTING };
    assert.deepEqual((await api.list({ copy: CARD.id, price: "1.5", asset: "STEEM", idempotencyKey: "k".repeat(20) })).value, LISTING);
    assert.equal(requests.at(-1).init.headers["Idempotency-Key"], "k".repeat(20));
    assert.deepEqual(JSON.parse(requests.at(-1).init.body), { copy: CARD.id, price: "1.5", asset: "STEEM" });
    answer = { purchase: PURCHASE };
    assert.deepEqual((await api.buy(LISTING.id)).value, PURCHASE);
    assert.match(requests.at(-1).url, /\/api\/listings\/00000000-0000-4000-8000-000000000001\/buy$/);
    answer = { purchase: { ...PURCHASE, status: "COMPLETED", payment: null, txId: TX_ID } };
    assert.equal((await api.paymentHint(PURCHASE.id, TX_ID)).value.txId, TX_ID);
    answer = { listings: [LISTING], purchases: [PURCHASE] };
    assert.equal((await api.mine()).value.purchases.length, 1);

    for (const broken of [
      { purchase: { ...PURCHASE, payment: { ...PURCHASE.payment, memo: "send me more" } } },
      { purchase: { ...PURCHASE, payment: { ...PURCHASE.payment, to: "<b>" } } },
      { purchase: { ...PURCHASE, status: "STOLEN" } },
    ]) {
      answer = broken;
      assert.equal((await api.purchase(PURCHASE.id)).error.code, "BAD_RESPONSE", JSON.stringify(broken).slice(0, 80));
    }
    answer = { listings: [{ ...LISTING, price: { asset: "STEEM", amount: "1,5" } }], total: 1, offset: 0, pageSize: 50 };
    assert.equal((await api.board({})).error.code, "BAD_RESPONSE");
  });
});

/** A scripted SalesApi: a purchase becomes DETECTED, then COMPLETED, as it is read. */
function fakeApi() {
  const calls = [];
  const progression = ["DETECTED", "COMPLETED"];
  return {
    calls,
    board: async (query) => (calls.push(["board", query]), ok({ listings: [LISTING, { ...LISTING, id: uuid(3), seller: "bob", reserved: true }], total: 2, offset: 0, pageSize: 50 })),
    mine: async () => (calls.push(["mine"]), ok({ listings: [], purchases: [] })),
    list: async (request) => (calls.push(["list", request]), request.price === "0" ? fail("VALIDATION", "price: from 0.001") : ok({ ...LISTING, id: uuid(4), seller: "bob" })),
    cancelListing: async (id) => (calls.push(["cancelListing", id]), ok({ ...LISTING, id, seller: "bob", status: "CANCELLED" })),
    buy: async (id) => (calls.push(["buy", id]), ok(PURCHASE)),
    purchase: async (id) => {
      calls.push(["purchase", id]);
      const status = progression.shift() ?? "COMPLETED";
      return ok({ ...PURCHASE, status, payment: null, txId: TX_ID });
    },
    paymentHint: async (id, txId) => (calls.push(["paymentHint", id, txId]), ok({ ...PURCHASE, status: "DETECTED", payment: null, txId })),
    release: async (id) => (calls.push(["release", id]), ok({ ...PURCHASE, status: "CANCELLED", payment: null })),
  };
}

function fakeWallet(answers = [ok(TX_ID)]) {
  const requests = [];
  return { requests, name: "Steem Keychain", isAvailable: () => true, signMessage: async () => fail("X", "x"), requestTransfer: async (request) => (requests.push(request), answers.shift() ?? ok(TX_ID)) };
}

/** A realtime connection the test speaks for: `push` a server message, `status` a change of state. */
function fakeConnection() {
  const listeners = new Set();
  const watchers = new Set();
  return {
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    onStatus: (listener) => (watchers.add(listener), () => watchers.delete(listener)),
    push: (t, d = {}) => listeners.forEach((listener) => listener({ t, d })),
    status: (status) => watchers.forEach((listener) => listener(status, { code: null })),
  };
}

function market({ account = "bob", wallet = fakeWallet() } = {}) {
  const api = fakeApi();
  const connection = fakeConnection();
  let reloads = 0;
  const copy = (id, serial, tradeable, status = "active") => ({ id: uuid(id), edition: "core-1", serial, status, tradeable });
  const accountService = { state: { account }, collection: { state: { cards: [{ definitionId: "iron_watcher", copies: [copy(31, 1, true), copy(32, 2, false), copy(33, 3, true, "locked")] }] } } };
  const sales = new SalesService({ api, wallet, account: accountService, scheduler: immediateScheduler, newKey: () => "list-key-000000000001", onCollectionChanged: () => (reloads += 1), connection });
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  const navigated = [];
  const services = { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: (id, params) => navigated.push([id, params]), hasScene: () => true };
  const scene = new MarketScene(services, { content, account: accountService, sales }, () => NOW);
  return { api, wallet, sales, scene, navigated, connection, reloads: () => reloads };
}

const byId = (scene, id) => scene.root.findById(id);
const rendered = (scene) => {
  const context = new FakeContext2D();
  scene.render(context);
  return context.texts;
};

describe("SalesService", () => {
  it("reserves, pays the seller exactly as the server says, and waits for the card", async () => {
    const { api, wallet, sales, reloads } = market();
    const bought = await sales.buy(LISTING.id);
    assert.equal(bought.ok, true);
    assert.deepEqual(wallet.requests, [{ from: "bob", to: "alice", amount: "1.500", asset: "STEEM", memo: MEMO }]);
    assert.deepEqual(api.calls.find((call) => call[0] === "paymentHint"), ["paymentHint", PURCHASE.id, TX_ID]);
    assert.equal(sales.state.buying.stage, BuyStage.DONE);
    assert.equal(reloads(), 1, "the collection reloads with the new card");
  });

  it("keeps an unpaid purchase when the wallet refuses: pay again, or release it", async () => {
    const { api, sales } = market({ wallet: fakeWallet([fail("WALLET_REJECTED", "cancelled"), fail("WALLET_TIMEOUT", "late")]) });
    await sales.buy(LISTING.id);
    assert.deepEqual([sales.state.buying.stage, sales.state.buying.purchase.id], [BuyStage.FAILED, PURCHASE.id]);
    assert.equal(api.calls.some((call) => call[0] === "release"), false, "never released behind the player's back");
    await sales.payAgain();
    assert.equal(sales.state.buying.error.code, "WALLET_TIMEOUT");
    await sales.release();
    assert.deepEqual(api.calls.find((call) => call[0] === "release"), ["release", PURCHASE.id]);
    assert.equal(sales.state.buying.stage, BuyStage.NONE);
  });

  it("refuses to buy signed out, and sells in the market's asset", async () => {
    assert.equal((await market({ account: null }).sales.buy(LISTING.id)).error.code, "SIGNED_OUT");
    const { api, sales } = market();
    assert.equal(await sales.sell({ copy: uuid(31), price: " 2.25 " }), true);
    assert.deepEqual(api.calls.find((call) => call[0] === "list"), ["list", { copy: uuid(31), price: "2.25", asset: "STEEM", idempotencyKey: "list-key-000000000001" }]);
    assert.match(sales.state.notice, /On the board for 1\.500 STEEM/);
  });
});

describe("MarketScene", () => {
  it("shows the board, a listing's details, and buys it through the wallet", async () => {
    const { scene, wallet, navigated } = market();
    scene.enter({ from: "shop" });
    await flush();
    const row = byId(scene, `market.listing.${LISTING.id}`);
    assert.equal(row.text, "1.500 STEEM");
    assert.equal(byId(scene, `market.seller.${LISTING.id}`).account, "alice", "the seller's portrait beside their name");
    assert.equal(byId(scene, `market.listing.${uuid(3)}`).text, "reserved");
    row.activate();
    assert.ok(rendered(scene).some((text) => text.includes("Sold by @alice")));
    byId(scene, "market.buy").activate();
    await flush();
    await flush();
    assert.equal(wallet.requests.length, 1);
    assert.ok(rendered(scene).some((text) => text.includes("the card is in your collection")));
    byId(scene, "market.buying.close").activate();
    assert.equal(byId(scene, "market.buying.close"), null);

    byId(scene, `market.listing.${uuid(3)}`).activate();
    assert.equal(byId(scene, "market.buy"), null, "no buying one's own card");
    assert.equal(byId(scene, "market.withdraw").enabled, false, "not while a buyer is paying");
    scene.onCancel();
    assert.deepEqual(navigated.at(-1), ["shop", undefined], "back to the shop it came from");
  });

  it("reloads the board on screen when the server says it changed, once per burst", async () => {
    const { scene, api, connection } = market();
    const reads = (name) => api.calls.filter(([call]) => call === name).length;
    connection.push("sales.board", { listingId: LISTING.id });
    await flush();
    assert.equal(reads("board"), 0, "nobody is looking at the board");

    scene.enter({});
    await flush();
    const opened = reads("board");
    connection.push("sales.board", { listingId: LISTING.id });
    connection.push("sales.board", { listingId: uuid(3) });
    connection.push("sales.board", { listingId: uuid(4) });
    await flush();
    await flush();
    assert.equal(reads("board"), opened + 1, "three changes, one read");
    assert.equal(reads("mine"), 1, "only on entering");

    connection.push("sale.updated", { listingId: LISTING.id });
    await flush();
    await flush();
    assert.deepEqual([reads("board"), reads("mine")], [opened + 2, 2], "one of the player's own changed: their activity too");
    connection.status("open");
    await flush();
    await flush();
    assert.deepEqual([reads("board"), reads("mine")], [opened + 3, 3], "back from a drop: what was missed is read again");

    scene.exit();
    connection.push("sales.board", { listingId: LISTING.id });
    await flush();
    assert.equal(reads("board"), opened + 3, "not once the market is closed");
  });

  it("lists a tradeable, free copy for a price", async () => {
    const { scene, api } = market();
    scene.enter({});
    await flush();
    byId(scene, "market.sell").activate();
    assert.equal(byId(scene, `market.copy.${uuid(32)}`), null, "untradeable copies cannot be sold");
    assert.equal(byId(scene, `market.copy.${uuid(33)}`), null, "nor copies already held elsewhere");
    assert.equal(byId(scene, "market.list").enabled, false);
    byId(scene, `market.copy.${uuid(31)}`).activate();
    byId(scene, "market.price").onChange("2,5");
    assert.deepEqual([byId(scene, "market.list").enabled, byId(scene, "market.list").text], [true, "Sell for 2.5 STEEM"]);
    byId(scene, "market.list").activate();
    await flush();
    assert.deepEqual(api.calls.find((call) => call[0] === "list")[1].price, "2.5");
    assert.equal(byId(scene, "market.list"), null, "back to the player's sales");
  });

  it("filters the board by faction, rarity and type through the server, and the copies to sell on the spot", async () => {
    const { scene, api } = market();
    scene.enter({});
    await flush();
    assert.equal(api.calls.find((call) => call[0] === "board")[1].card, undefined, "every card at first");
    byId(scene, "market.filter.faction.iron").activate();
    byId(scene, "market.filter.type.creature").activate();
    await flush();
    const asked = api.calls.filter((call) => call[0] === "board").at(-1)[1];
    const ironCreatures = content.catalog.all().filter((card) => card.faction === "iron" && card.type === "creature").map((card) => card.id);
    assert.deepEqual([asked.card.split(",").sort(), asked.offset], [ironCreatures.sort(), 0], "the cards the filter lets through, from the first page");
    assert.equal(byId(scene, "market.filter.faction.iron").variant, "primary");

    byId(scene, "market.sell").activate();
    assert.ok(byId(scene, `market.copy.${uuid(31)}`), "the composer has a filter of its own");
    byId(scene, `market.copy.${uuid(31)}`).activate();
    byId(scene, "market.sellFilter.faction.ember").activate();
    assert.equal(byId(scene, `market.copy.${uuid(31)}`), null, "an iron copy is not an ember card");
    assert.ok(rendered(scene).includes("No ember cards to sell."));
    assert.equal(byId(scene, "market.list").enabled, false, "a hidden copy is no longer chosen");
  });

  it("describes listings, and goes back where the player came from", () => {
    assert.equal(listingSubtitle(LISTING, NOW), "#4 · @alice · 3 day(s) left");
    assert.equal(listingSubtitle({ ...LISTING, status: "SOLD", buyer: "bob" }, NOW), "#4 · sold to @bob");
    assert.equal(listingSubtitle({ ...LISTING, reserved: true }, NOW), "#4 · @alice · a buyer is paying");
    const { scene, navigated } = market({ account: null });
    scene.enter({ from: "collection" });
    assert.equal(byId(scene, "market.sell"), null, "signed out: nothing to sell");
    scene.onCancel();
    assert.deepEqual(navigated.at(-1), ["collection", undefined]);
  });
});
