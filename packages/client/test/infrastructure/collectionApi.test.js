/**
 * HttpCollectionApi: the requests it sends (paths, anti-CSRF header,
 * If-Match) and the responses it lets through to the application.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpCollectionApi } from "../../src/infrastructure/api/HttpCollectionApi.js";

const DECK_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const COPY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const DECK = Object.freeze({ id: DECK_ID, name: "Iron", cards: [{ cardId: "iron_watcher", count: 2 }], version: 3, playable: false, problems: [{ code: "TOO_SMALL", message: "deck has 2 cards", cardId: null }] });
const CHOICE = Object.freeze({ id: "precon_foundry", name: "Iron Foundry", size: 30, cards: [{ cardId: "iron_watcher", count: 3 }] });

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** @param {(url: string, init: any) => Response | Promise<Response>} handler */
function apiWith(handler) {
  const requests = [];
  const api = new HttpCollectionApi({ fetch: async (url, init) => (requests.push({ url, init }), handler(url, init)) });
  return { api, requests };
}

describe("HttpCollectionApi", () => {
  it("reads the starter offer and claims one with the anti-CSRF header", async () => {
    const offer = apiWith(() => json(200, { claimed: false, choices: [CHOICE] }));
    assert.deepEqual((await offer.api.starter()).value, { claimed: false, choices: [CHOICE] });
    assert.equal(offer.requests[0].url, "/api/starter");
    assert.equal(offer.requests[0].init.method, "GET");

    const claim = apiWith(() => json(201, { deck: DECK, cardsGranted: 30 }));
    const claimed = await claim.api.claimStarter("precon_foundry");
    assert.equal(claimed.value.cardsGranted, 30);
    assert.equal(claimed.value.deck.problems[0].cardId, null);
    const [{ url, init }] = claim.requests;
    assert.equal(url, "/api/starter");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["X-M8-Request"], "1");
    assert.equal(init.body, JSON.stringify({ starterId: "precon_foundry" }));
  });

  it("reads the collection", async () => {
    const copy = { id: COPY_ID, edition: "core-1", serial: 12, status: "active", tradeable: true };
    const { api } = apiWith(() => json(200, { cards: [{ definitionId: "iron_watcher", copies: [copy, { ...copy, tradeable: undefined }] }] }));
    assert.deepEqual((await api.collection()).value, [{ definitionId: "iron_watcher", copies: [copy, { ...copy, tradeable: false }] }], "a copy the server does not call tradeable is not");
  });

  it("creates, updates with If-Match, lists and deletes decks", async () => {
    const { api, requests } = apiWith((url, init) => (init.method === "DELETE" ? new Response(null, { status: 204 }) : json(init.method === "POST" ? 201 : 200, init.method === "GET" ? { decks: [DECK], limit: 50 } : { deck: DECK })));
    const input = { name: "Iron", cards: [{ cardId: "iron_watcher", count: 2 }] };
    assert.equal((await api.createDeck(input)).value.id, DECK_ID);
    assert.equal((await api.updateDeck(DECK_ID, 3, input)).value.version, 3);
    assert.equal((await api.listDecks()).value.length, 1);
    assert.equal((await api.deleteDeck(DECK_ID)).ok, true);
    assert.deepEqual(requests.map(({ url, init }) => `${init.method} ${url}`), ["POST /api/decks", `PUT /api/decks/${DECK_ID}`, "GET /api/decks", `DELETE /api/decks/${DECK_ID}`]);
    assert.equal(requests[1].init.headers["If-Match"], '"3"');
  });

  it("never puts a non-UUID id in a path", async () => {
    const { api, requests } = apiWith(() => json(200, {}));
    assert.equal((await api.updateDeck("../me", 1, { name: "x", cards: [] })).error.code, "BAD_RESPONSE");
    assert.equal((await api.deleteDeck("d_123")).error.code, "BAD_RESPONSE");
    assert.equal(requests.length, 0);
  });

  it("turns unexpected shapes into BAD_RESPONSE and passes server errors through", async () => {
    const shapes = [
      { claimed: "no", choices: [] },
      { claimed: false, choices: [{ ...CHOICE, size: 0 }] },
      { claimed: false, choices: [{ ...CHOICE, cards: [{ cardId: "x", count: -1 }] }] },
    ];
    for (const body of shapes) {
      assert.equal((await apiWith(() => json(200, body)).api.starter()).error.code, "BAD_RESPONSE", JSON.stringify(body));
    }
    assert.equal((await apiWith(() => json(200, { cards: [{ definitionId: "x", copies: [{ id: "not-a-uuid" }] }] })).api.collection()).error.code, "BAD_RESPONSE");
    assert.equal((await apiWith(() => json(200, { decks: [{ ...DECK, id: "1" }] })).api.listDecks()).error.code, "BAD_RESPONSE");
    assert.equal((await apiWith(() => json(200, { decks: [{ ...DECK, version: 0 }] })).api.listDecks()).error.code, "BAD_RESPONSE");
    assert.equal((await apiWith(() => json(201, { deck: DECK, cardsGranted: 0 })).api.claimStarter("x")).error.code, "BAD_RESPONSE");

    const conflict = await apiWith(() => json(412, { error: { code: "PRECONDITION_FAILED", message: "changed elsewhere", details: { version: 4 } } })).api.updateDeck(DECK_ID, 3, { name: "x", cards: [] });
    assert.deepEqual(conflict.error, { code: "PRECONDITION_FAILED", message: "changed elsewhere", details: { version: 4 } });
    assert.equal((await apiWith(() => Promise.reject(new TypeError("offline"))).api.collection()).error.code, "NETWORK");
  });
});
