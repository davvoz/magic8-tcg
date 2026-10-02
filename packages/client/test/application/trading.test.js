/**
 * Trades on the client (docs/tcg/13): the HTTP adapter checks every answer,
 * the service lists and acts on trades (and reloads the collection when
 * copies moved), and the screen lists trades, offers the right actions,
 * and composes a new offer from tradeable copies, asking only for cards
 * the recipient has.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { TradingService } from "../../src/application/trading/TradingService.js";
import { HttpTradingApi } from "../../src/infrastructure/api/HttpTradingApi.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { immediateScheduler } from "../../src/infrastructure/time/ImmediateScheduler.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { TradesScene, tradeSubtitle } from "../../src/rendering/scenes/TradesScene.js";
import { FakeContext2D, loadTheme } from "../rendering/fakes.js";
import { loadBundledContent } from "./fixtures.js";

const theme = loadTheme();
const content = await loadBundledContent();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const NOW = 1_790_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TRADE = Object.freeze({
  id: uuid(1),
  status: "OPEN",
  role: "counterparty",
  proposer: "alice",
  counterparty: "bob",
  give: [{ id: uuid(11), definitionId: "ember_imp", serial: 4 }],
  wants: [{ definitionId: "iron_watcher", count: 2 }],
  take: [],
  createdAt: NOW,
  expiresAt: NOW + 2 * DAY + 1,
  closedAt: null,
});
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("HttpTradingApi", () => {
  it("lists and acts on trades, sending the idempotency key, and refuses malformed answers", async () => {
    const requests = [];
    let answer = { trades: [TRADE] };
    const api = new HttpTradingApi({ fetch: async (url, init) => (requests.push({ url, init }), json(200, answer)) });
    assert.deepEqual((await api.list()).value, [TRADE]);
    answer = { trade: TRADE };
    assert.deepEqual((await api.propose({ to: "bob", give: [uuid(11)], want: [], idempotencyKey: "k".repeat(20) })).value, TRADE);
    assert.equal(requests.at(-1).init.headers["Idempotency-Key"], "k".repeat(20));
    assert.equal((await api.accept(TRADE.id)).ok, true);
    assert.match(requests.at(-1).url, /\/api\/trades\/00000000-0000-4000-8000-000000000001\/accept$/);
    answer = { trade: { ...TRADE, proposer: "<b>" } };
    assert.equal((await api.cancel(TRADE.id)).error.code, "BAD_RESPONSE");
    answer = { trades: [{ ...TRADE, status: "STOLEN" }] };
    assert.equal((await api.list()).error.code, "BAD_RESPONSE");
    answer = { cards: [{ definitionId: "iron_watcher", count: 2 }] };
    assert.deepEqual((await api.tradeableOf("carol")).value, [{ definitionId: "iron_watcher", count: 2 }]);
    assert.match(requests.at(-1).url, /\/api\/trades\/tradeable\/carol$/);
    answer = { cards: [{ definitionId: "<script>", count: 1 }] };
    assert.equal((await api.tradeableOf("carol")).error.code, "BAD_RESPONSE");
  });
});

/** A scripted TradingApi. */
function fakeApi() {
  const calls = [];
  const state = { trades: [TRADE] };
  const result = (trade) => ok(trade);
  return {
    calls,
    list: async () => (calls.push(["list"]), ok(state.trades)),
    tradeableOf: async (account) => (calls.push(["tradeableOf", account]), account === "ghost" ? fail("VALIDATION", "trade with another player who has played here before") : ok(account === "carol" ? [{ definitionId: "iron_watcher", count: 2 }, { definitionId: "ember_imp", count: 1 }] : [])),
    propose: async (offer) => (calls.push(["propose", offer]), offer.to === "nobody" ? fail("VALIDATION", "trade with another player who has played here before") : result({ ...TRADE, id: uuid(2), role: "proposer", proposer: "bob", counterparty: offer.to })),
    accept: async (id) => (calls.push(["accept", id]), result({ ...TRADE, status: "ACCEPTED", take: [{ id: uuid(21), definitionId: "iron_watcher", serial: 9 }] })),
    decline: async (id) => (calls.push(["decline", id]), result({ ...TRADE, status: "DECLINED" })),
    cancel: async (id) => (calls.push(["cancel", id]), result({ ...TRADE, status: "CANCELLED" })),
  };
}

function screen() {
  const api = fakeApi();
  let reloads = 0;
  const trading = new TradingService({ api, newKey: () => "offer-key-000000000001", onCollectionChanged: () => (reloads += 1), scheduler: immediateScheduler });
  const copy = (id, serial, tradeable) => ({ id: uuid(id), edition: "core-1", serial, status: "active", tradeable });
  const account = { collection: { state: { cards: [{ definitionId: "ember_imp", copies: [copy(31, 1, true), copy(32, 2, false)] }] } } };
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  const navigated = [];
  const services = { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: (id) => navigated.push(id), hasScene: () => true };
  const scene = new TradesScene(services, { content, account, trading }, () => NOW);
  return { api, trading, scene, navigated, reloads: () => reloads };
}

const byId = (scene, id) => scene.root.findById(id);
const rendered = (scene) => {
  const context = new FakeContext2D();
  scene.render(context);
  return context.texts;
};

describe("TradesScene", () => {
  it("lists trades, shows the chosen one, and lets the counterparty accept it", async () => {
    const { api, scene, reloads } = screen();
    scene.enter({});
    await flush();
    const row = byId(scene, `trades.row.${TRADE.id}`);
    assert.equal(row.text, "from @alice");
    assert.equal(row.avatar, "alice");
    assert.equal(row.subtitle, "open · gives 1 · asks 2 · 3 day(s) left");
    row.activate();
    assert.ok(rendered(scene).some((text) => text.includes("@alice offers")));
    assert.equal(byId(scene, "trades.cancel"), null, "only the proposer cancels");
    byId(scene, "trades.accept").activate();
    await flush();
    assert.deepEqual(api.calls.at(-1), ["accept", TRADE.id]);
    assert.equal(reloads(), 1, "the collection reloads after copies moved");
    assert.equal(byId(scene, "trades.accept"), null, "an accepted trade has no more actions");
    assert.ok(rendered(scene).some((text) => text.includes("Trade done")));
  });

  it("composes an offer from tradeable copies only, and asks for cards by tapping", async () => {
    const { api, scene } = screen();
    scene.enter({});
    await flush();
    byId(scene, "trades.new").activate();
    assert.equal(byId(scene, `trades.give.${uuid(32)}`), null, "a copy the server calls untradeable cannot be offered");
    assert.equal(byId(scene, "trades.send").enabled, false);
    byId(scene, `trades.give.${uuid(31)}`).activate();
    assert.equal(byId(scene, "trades.ask.iron_watcher"), null, "no cards to ask for before a recipient is named");
    byId(scene, "trades.to").onChange("Carol");
    await flush();
    assert.deepEqual(api.calls.at(-1), ["tradeableOf", "carol"]);
    assert.equal(byId(scene, "trades.ask.arcane_apprentice"), null, "only cards carol has");
    byId(scene, "trades.filter.faction.iron").activate();
    assert.deepEqual([byId(scene, "trades.ask.ember_imp"), byId(scene, `trades.give.${uuid(31)}`)], [null, null], "one filter for both lists");
    assert.ok(byId(scene, "trades.ask.iron_watcher"));
    byId(scene, "trades.filter.type.spell").activate();
    assert.match(byId(scene, "trades.ask.message").text, /has no iron spell cards/);
    byId(scene, "trades.filter.faction.all").activate();
    byId(scene, "trades.filter.type.all").activate();
    assert.equal(byId(scene, `trades.give.${uuid(31)}`).selected, true, "a hidden choice stays chosen");
    assert.equal(byId(scene, "trades.ask.iron_watcher").subtitle, "has 2");
    for (let tap = 0; tap < 3; tap += 1) {
      byId(scene, "trades.ask.iron_watcher").activate();
    }
    assert.equal(byId(scene, "trades.ask.iron_watcher").subtitle, "has 2", "never more than carol has: the third tap goes back to none");
    byId(scene, "trades.ask.iron_watcher").activate();
    byId(scene, "trades.ask.iron_watcher").activate();
    assert.equal(byId(scene, "trades.ask.iron_watcher").subtitle, "asking 2 of 2");

    byId(scene, "trades.to").onChange("ghost");
    await flush();
    assert.equal(byId(scene, "trades.ask.iron_watcher"), null, "another recipient: the asks start over");
    assert.match(byId(scene, "trades.ask.message").text, /another player/, "an unknown player is explained");
    byId(scene, "trades.to").onChange("nobody");
    await flush();
    assert.match(byId(scene, "trades.ask.message").text, /no cards to trade/);
    assert.equal(byId(scene, "trades.send").enabled, true, "a gift needs no asks");
    byId(scene, "trades.send").activate();
    await flush();
    assert.deepEqual(api.calls.at(-1), ["propose", { to: "nobody", give: [uuid(31)], want: [], idempotencyKey: "offer-key-000000000001" }]);
    assert.ok(rendered(scene).some((text) => text.includes("another player")), "the refusal is shown");
    byId(scene, "trades.to").onChange("carol");
    await flush();
    byId(scene, "trades.ask.iron_watcher").activate();
    byId(scene, "trades.send").activate();
    await flush();
    assert.deepEqual(api.calls.at(-1), ["propose", { to: "carol", give: [uuid(31)], want: [{ definitionId: "iron_watcher", count: 1 }], idempotencyKey: "offer-key-000000000001" }]);
    await flush();
    assert.equal(byId(scene, "trades.send"), null, "back to the list");
    assert.equal(byId(scene, `trades.row.${uuid(2)}`).text, "to @carol");
  });

  it("describes closed trades and leaves on Escape", () => {
    assert.equal(tradeSubtitle({ ...TRADE, status: "EXPIRED" }, NOW), "expired · gives 1 · asks 2");
    const { scene, navigated } = screen();
    scene.enter({});
    scene.onCancel();
    assert.deepEqual(navigated, ["collection"]);
  });
});
