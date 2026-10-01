/**
 * The M2 flow over real HTTP, as the browser client drives it: sign in,
 * choose a starter, see the collection, build and edit a legal deck.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { openContent } from "@magic8/protocol";
import { validateStarterOffer } from "../../src/modules/onboarding/index.js";
import { buildTestApp, keyPair, listen } from "../helpers.js";
import { ApiClient } from "../support/apiClient.js";

const alice = keyPair(1);
const bob = keyPair(2);
const OFFERED = ["precon_ember", "precon_foundry", "precon_shadow", "precon_verdant", "precon_bastion"];

describe("new player flow over HTTP", () => {
  /** @type {Awaited<ReturnType<typeof buildTestApp>>} */
  let setup;
  /** @type {{ base: string, close: () => Promise<unknown> }} */
  let server;

  before(async () => {
    setup = await buildTestApp();
    setup.chain.setAccount("alice", [alice.publicKey]);
    setup.chain.setAccount("bob", [bob.publicKey]);
    server = await listen(setup.app);
  });

  after(() => server.close());

  it("offers one starter per faction, grants the chosen one once and saves it as a playable deck", async () => {
    const client = new ApiClient(server.base);
    await client.signIn("alice", alice.privateKey);

    const offer = await client.get("/api/starter");
    assert.equal(offer.status, 200);
    assert.equal(offer.json.claimed, false);
    assert.deepEqual(offer.json.choices.map((choice) => choice.id), OFFERED);
    const chosen = offer.json.choices.find((choice) => choice.id === "precon_shadow");

    const claim = await client.post("/api/starter", { starterId: "precon_shadow" });
    assert.equal(claim.status, 201, claim.text);
    assert.equal(claim.json.cardsGranted, chosen.size);
    assert.equal(claim.json.deck.name, chosen.name);
    assert.equal(claim.json.deck.playable, true, JSON.stringify(claim.json.deck.problems));
    assert.equal("faction" in claim.json.deck, false, "a deck has no faction: its cards say what it is");

    assert.equal((await client.get("/api/starter")).json.claimed, true);
    const again = await client.post("/api/starter", { starterId: "precon_verdant" });
    assert.equal(again.status, 409);
    assert.equal(again.json.error.code, "STARTER_ALREADY_CLAIMED");

    const collection = await client.get("/api/collection");
    const copies = collection.json.cards.reduce((sum, entry) => sum + entry.copies.length, 0);
    assert.equal(copies, chosen.size, "the second claim minted nothing");
    const decks = await client.get("/api/decks");
    assert.deepEqual(decks.json.decks.map((deck) => deck.id), [claim.json.deck.id]);
    assert.equal(decks.json.limit, 50);

    const card = collection.json.cards[0].copies[0];
    const detail = await client.get(`/api/collection/cards/${card.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.card.ownerId, undefined, "owner ids are not exposed");
    assert.deepEqual(detail.json.history.map((event) => event.kind), ["MINTED"]);
    assert.equal(await setup.app.audit.verify(), null);
    const actions = (await setup.database.rows("SELECT action FROM audit_logs ORDER BY seq")).map((row) => row.action);
    assert.ok(actions.includes("collection.starter_claimed"));
  });

  it("lets only one of several concurrent claims through", async () => {
    const client = new ApiClient(server.base);
    await client.signIn("bob", bob.privateKey);
    const claims = await Promise.all(OFFERED.map((starterId) => client.post("/api/starter", { starterId })));
    assert.deepEqual(claims.map((claim) => claim.status).sort(), [201, ...OFFERED.slice(1).map(() => 409)]);
    const copies = (await client.get("/api/collection")).json.cards.reduce((sum, entry) => sum + entry.copies.length, 0);
    assert.equal(copies, claims.find((claim) => claim.status === 201).json.cardsGranted);
  });

  it("builds, edits and deletes decks with version checks", async () => {
    const client = new ApiClient(server.base);
    await client.signIn("alice", alice.privateKey);
    const [starterDeck] = (await client.get("/api/decks")).json.decks;
    const body = { name: "My build", cards: starterDeck.cards };

    const created = await client.post("/api/decks", body);
    assert.equal(created.status, 201, created.text);
    assert.equal(created.headers.get("etag"), '"1"');
    const path = `/api/decks/${created.json.deck.id}`;

    assert.equal((await client.put(path, body)).status, 428, "If-Match is required");
    const edited = await client.put(path, { ...body, name: "My build v2" }, { "If-Match": '"1"' });
    assert.equal(edited.status, 200, edited.text);
    assert.equal(edited.headers.get("etag"), '"2"');
    const stale = await client.put(path, { ...body, name: "Lost update" }, { "If-Match": '"1"' });
    assert.equal(stale.status, 412);
    assert.equal((await client.put(path, body, { "If-Match": "garbage" })).status, 400);

    const notOwned = await client.post("/api/decks", { ...body, cards: [{ cardId: "void_conjurer", count: 1 }] });
    assert.equal(notOwned.status, 422);
    assert.equal(notOwned.json.error.code, "CARDS_NOT_OWNED");
    assert.equal((await client.post("/api/decks", { ...body, extra: 1 })).status, 400, "unknown fields are refused");
    assert.equal((await client.post("/api/decks", { ...body, faction: "iron" })).status, 400, "decks have no faction any more");

    assert.equal((await client.delete(path)).status, 204);
    assert.equal((await client.get(path)).status, 404);
  });

  it("keeps players' data apart", async () => {
    const aliceClient = new ApiClient(server.base);
    await aliceClient.signIn("alice", alice.privateKey);
    const bobClient = new ApiClient(server.base);
    await bobClient.signIn("bob", bob.privateKey);
    const [aliceDeck] = (await aliceClient.get("/api/decks")).json.decks;
    const aliceCard = (await aliceClient.get("/api/collection")).json.cards[0].copies[0];
    assert.equal((await bobClient.get(`/api/decks/${aliceDeck.id}`)).status, 404);
    assert.equal((await bobClient.put(`/api/decks/${aliceDeck.id}`, { name: "x", cards: [] }, { "If-Match": `"${aliceDeck.version}"` })).status, 404);
    assert.equal((await bobClient.delete(`/api/decks/${aliceDeck.id}`)).status, 404);
    assert.equal((await bobClient.get(`/api/collection/cards/${aliceCard.id}`)).status, 404);
  });

  it("requires a session for everything personal", async () => {
    const anonymous = new ApiClient(server.base);
    for (const [method, path] of [
      ["GET", "/api/starter"],
      ["POST", "/api/starter"],
      ["GET", "/api/collection"],
      ["GET", "/api/decks"],
      ["POST", "/api/decks"],
    ]) {
      const response = await anonymous.request(method, path, method === "POST" ? {} : undefined, {});
      assert.equal(response.status, 401, `${method} ${path}`);
    }
  });

  it("serves the content by hash, byte for byte, to anyone", async () => {
    const anonymous = new ApiClient(server.base);
    const current = await anonymous.get("/api/content/current");
    assert.equal(current.status, 200);
    assert.equal(current.json.engineVersion, "0.1.0");
    const payload = await anonymous.get(`/api/content/${current.json.hash}`);
    assert.equal(payload.status, 200);
    assert.match(payload.headers.get("cache-control"), /immutable/);
    assert.notEqual(openContent(payload.text, current.json.hash), null, "the downloaded bytes hash to the advertised content");
    assert.equal((await anonymous.get(`/api/content/${"0".repeat(64)}`)).status, 404);
    assert.equal((await anonymous.get("/api/content/not-a-hash")).status, 404);
  });
});

describe("starter offer data", () => {
  it("refuses offers that do not match the content", async () => {
    const setup = await buildTestApp();
    const current = contentOf(setup);
    const valid = { schemaVersion: 1, edition: "core-1", choices: OFFERED };
    assert.equal(validateStarterOffer(valid, current).ok, true);
    for (const offer of [
      { ...valid, choices: ["precon_missing"] },
      { ...valid, choices: [] },
      { ...valid, choices: ["precon_foundry", "precon_foundry"] },
      { ...valid, edition: "Core 1" },
      { ...valid, extra: true },
      { ...valid, schemaVersion: 2 },
    ]) {
      assert.equal(validateStarterOffer(offer, current).ok, false, JSON.stringify(offer));
    }
  });

  it("publishes content idempotently across restarts", async () => {
    const setup = await buildTestApp();
    const first = setup.app.catalog.current().hash;
    const restarted = await buildTestApp({ database: setup.database });
    assert.equal(restarted.app.catalog.current().hash, first);
    const versions = await setup.database.rows("SELECT hash, is_current FROM content_versions");
    assert.deepEqual(versions.map((row) => [row.hash, row.is_current]), [[first, true]]);
    const cards = await setup.database.rows("SELECT count(*)::integer AS n FROM card_definitions");
    assert.equal(cards[0].n, contentOf(setup).catalog.size);
  });
});

/** @param {Awaited<ReturnType<typeof buildTestApp>>} setup */
function contentOf(setup) {
  return setup.app.catalog.current().content;
}
