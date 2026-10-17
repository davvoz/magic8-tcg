/**
 * Ranked entries in the client: read from the server, what the lobby says
 * about them, the shop's Ranked shelf, and the notification of entries bought.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { EntryService, rankedEntriesText, rankedFeeText } from "../../src/application/entries/EntryService.js";
import { describeNotification } from "../../src/application/notifications/describeNotification.js";
import { rankedEntryPrice, shelvesOf } from "../../src/application/shop/shopCatalog.js";
import { HttpEntriesApi } from "../../src/infrastructure/api/HttpEntriesApi.js";
import { doneText } from "../../src/rendering/scenes/ShopScene.js";
import { LISTING, LISTING_WITH_ENTRIES } from "./fakeMarketApi.js";

const RANKED = Object.freeze({ kind: "ranked", balance: 3, perGame: 1, season: "season-1" });

/** An EntriesApi answering `replies` in turn. */
const scripted = (...replies) => ({ entries: async () => replies.shift() });

describe("EntryService", () => {
  it("reads the player's ranked entries, and says whether a ranked game is within reach", async () => {
    const entries = new EntryService({ api: scripted(ok([RANKED]), ok([{ ...RANKED, balance: 0 }]), fail("NETWORK", "offline")) });
    assert.equal(entries.ranked, null);
    assert.equal(entries.canPlayRanked, true, "not known yet: the server decides");
    const seen = [];
    entries.subscribe((state) => seen.push(state.loading));
    await entries.refresh();
    assert.deepEqual(entries.ranked, RANKED);
    assert.equal(entries.canPlayRanked, true);
    await entries.refresh();
    assert.equal(entries.canPlayRanked, false, "none left");
    await entries.refresh();
    assert.equal(entries.state.error, "offline");
    assert.equal(entries.ranked?.balance, 0, "what was known stays");
    assert.deepEqual(seen, [true, false, true, false, true, false]);
    entries.reset();
    assert.equal(entries.ranked, null);
  });

  it("drops an answer that arrives after the player signed out", async () => {
    let answer;
    const entries = new EntryService({ api: { entries: () => new Promise((resolve) => (answer = resolve)) } });
    const reading = entries.refresh();
    entries.reset();
    answer(ok([RANKED]));
    await reading;
    assert.equal(entries.ranked, null);
  });

  it("tells the lobby what a ranked game takes, in entries (never in money), and what the player has", () => {
    assert.equal(rankedEntriesText(3), "3 ranked tickets");
    assert.equal(rankedEntriesText(1), "1 ranked ticket");
    assert.equal(rankedFeeText(RANKED), "1 ranked ticket");
    assert.equal(rankedFeeText({ ...RANKED, perGame: 2 }), "2 ranked tickets");
    assert.equal(rankedFeeText({ ...RANKED, perGame: 0 }), null, "free: no fee");
    assert.equal(rankedFeeText(null), null);
  });
});

describe("HttpEntriesApi", () => {
  /** @param {unknown} body */
  const apiAnswering = (body) => {
    const requests = [];
    const fetch = async (url, init) => (requests.push({ url, init }), { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => body, text: async () => JSON.stringify(body) });
    return { api: new HttpEntriesApi({ fetch }), requests };
  };

  it("reads /api/entries and checks its shape", async () => {
    const { api, requests } = apiAnswering({ entries: [RANKED] });
    assert.deepEqual((await api.entries()).value, [RANKED]);
    assert.equal(requests[0].url, "/api/entries");
    for (const bad of [{}, { entries: [{ ...RANKED, balance: -1 }] }, { entries: [{ ...RANKED, perGame: "1" }] }, { entries: [{ ...RANKED, season: 3 }] }]) {
      assert.equal((await apiAnswering(bad).api.entries()).error.code, "BAD_RESPONSE", JSON.stringify(bad));
    }
  });
});

describe("ranked entries in the shop", () => {
  it("puts products of ranked entries on a shelf of their own", () => {
    assert.deepEqual(shelvesOf(LISTING_WITH_ENTRIES).ranked.map((product) => product.id), ["ranked_entry"]);
    assert.equal(shelvesOf(LISTING_WITH_ENTRIES).offers.some((product) => product.id === "ranked_entry"), false);
    assert.deepEqual(shelvesOf(LISTING).ranked, []);
    assert.deepEqual(rankedEntryPrice(LISTING_WITH_ENTRIES), { asset: "STEEM", amount: "1.000" });
    assert.equal(rankedEntryPrice(LISTING), null);
    assert.equal(rankedEntryPrice(null), null);
  });

  it("says what a fulfilled order gave", () => {
    const fulfilment = (entries, cards = []) => ({ txId: null, cards, packs: [], entries });
    assert.equal(doneText(fulfilment([{ kind: "ranked", count: 5 }])), "Done: 5 ranked tickets are yours, and in the season's jackpot.");
    assert.equal(doneText(fulfilment([{ kind: "ranked", count: 1 }])), "Done: 1 ranked ticket is yours, and in the season's jackpot.");
    const card = { id: "00000000-0000-4000-8000-000000000001", definitionId: "ember_imp", edition: "core-1", serial: 1 };
    assert.equal(doneText(fulfilment([{ kind: "ranked", count: 2 }], [card])), "Done: 2 ranked tickets are yours, and in the season's jackpot. Your cards are in your collection.");
    assert.equal(doneText(fulfilment([], [card])), "Done: your cards are in your collection.");
    assert.equal(doneText(null), "Done: your cards are in your collection.");
  });

  it("tells the buyer their entries are ready, and leads to the lobby", () => {
    const catalog = new Map();
    const notification = (data) => describeNotification({ id: 1, kind: "shop.fulfilled", data, createdAt: 0, read: false }, catalog);
    const entries = notification({ orderId: "o1", items: [{ productId: "ranked_entry", name: "Ranked Entry", quantity: 5 }], cards: [], total: 0, entries: [{ kind: "ranked", count: 5 }] });
    assert.deepEqual([entries.title, entries.body, entries.target], ["Your ranked tickets are ready", "5× Ranked Entry: 5 ranked tickets to play with, and in the season's jackpot.", "ranked"]);
    const one = notification({ items: [{ name: "Ranked Entry", quantity: 1 }], cards: [], total: 0, entries: [{ kind: "ranked", count: 1 }] });
    assert.equal(one.body, "Ranked Entry: 1 ranked ticket to play with, and in the season's jackpot.");
    const both = notification({ items: [{ name: "Core Booster", quantity: 1 }, { name: "Ranked Entry", quantity: 2 }], cards: [{ definitionId: "ember_imp", count: 5 }], total: 5, entries: [{ kind: "ranked", count: 2 }] });
    assert.equal(both.body, "Core Booster, 2× Ranked Entry: 5 cards added to your collection, and 2 ranked tickets to play with.");
    const cardsOnly = notification({ items: [{ name: "Core Booster", quantity: 1 }], cards: [{ definitionId: "ember_imp", count: 5 }], total: 5 });
    assert.equal(cardsOnly.title, "Your cards have arrived", "an older order says nothing of entries");
  });
});
