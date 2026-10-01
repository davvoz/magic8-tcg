/**
 * The signed-in player's account on the client: the collection, the
 * starter deck, account decks behind the deck builder, and forgetting all
 * of it on sign-out. Driven against an in-memory game server.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ok } from "@magic8/engine/shared/Result.js";
import { AccountStatus } from "../../src/application/account/AccountService.js";
import { CollectionError, CollectionService, CollectionStatus } from "../../src/application/collection/CollectionService.js";
import { DeckStorage } from "../../src/application/decks/AccountDeckRepository.js";
import { RemoteDeckError, RemoteDeckRepository, clientDeckId } from "../../src/infrastructure/api/RemoteDeckRepository.js";
import { ALICE, BOB, accountWorld, settle } from "./accountWorld.js";
import { fakeCollectionApi } from "./fakeCollectionApi.js";
import { loadBundledContent } from "./fixtures.js";

const content = await loadBundledContent();
const setup = (options) => accountWorld(content, options);

async function signedIn(options) {
  const world = setup(options);
  world.identity.become(ALICE);
  await settle();
  assert.equal(world.account.state.status, AccountStatus.READY);
  return world;
}

describe("AccountService", () => {
  it("starts signed out: browser decks and the whole catalog", () => {
    const { account, repository, builder, collection, server } = setup();
    assert.equal(account.state.status, AccountStatus.SIGNED_OUT);
    assert.equal(account.needsStarter, false);
    assert.equal(repository.storage, DeckStorage.BROWSER);
    assert.equal(collection.ownedCounts(), null);
    builder.startNew();
    assert.equal(builder.browse().length, content.catalog.size);
    assert.equal(server.calls.length, 0, "nothing is asked of the server");
  });

  it("loads the account on sign-in and offers the starter deck; the builder offers only owned cards", async () => {
    const { account, identity, repository, builder, server } = setup();
    const states = [];
    account.subscribe((state) => states.push(state.status));
    identity.become(ALICE);
    assert.equal(account.state.status, AccountStatus.LOADING);
    assert.equal(account.state.account, "alice");
    await settle();
    assert.deepEqual(states, [AccountStatus.LOADING, AccountStatus.LOADING, AccountStatus.READY]);
    assert.deepEqual(server.calls.map((call) => call.name).sort(), ["collection", "listDecks", "starter"]);
    assert.equal(account.needsStarter, true);
    assert.equal(repository.storage, DeckStorage.ACCOUNT);
    assert.deepEqual(repository.list().value, []);
    builder.startNew();
    assert.deepEqual(builder.browse(), [], "nothing owned yet");
  });

  it("claims the starter: cards in the collection, the deck in the account, ready to edit and save", async () => {
    const { account, repository, accountDecks, builder, collection, server } = await signedIn();
    const claimed = await account.claimStarter("precon_foundry");
    assert.equal(claimed.ok, true, JSON.stringify(claimed));
    assert.equal(claimed.value.cardsGranted, 30);
    assert.equal(account.needsStarter, false);
    assert.equal(account.state.status, AccountStatus.READY);
    const foundry = content.preconDecks.find((deck) => deck.id === "precon_foundry");
    assert.equal([...collection.ownedCounts().values()].reduce((total, count) => total + count, 0), 30);

    const [deck] = repository.list().value;
    assert.equal(deck.name, foundry.name);
    assert.equal(deck.id, clientDeckId(server.state.decks.keys().next().value));
    assert.match(deck.id, /^d_[0-9a-f]{32}$/);

    assert.equal(builder.edit(deck).ok, true);
    const first = foundry.entries.find((entry) => entry.count < content.deckRules.maxCopies);
    assert.equal(builder.addCard(first.cardId).error.code, "NOT_OWNED", "every owned copy is already in the deck");
    assert.equal(builder.removeCard(first.cardId).ok, true);
    assert.equal(builder.rename("Foundry, tuned").ok, true);
    const saved = await builder.save();
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal(saved.value.id, deck.id, "same deck, same id");
    assert.equal(accountDecks.describe(deck.id).version, 2);
    assert.equal(builder.addCard(first.cardId).ok, true, "the removed copy can go back");
    assert.equal((await builder.save()).ok, true, "the next save sends the new version");
    assert.deepEqual(server.calls.filter((call) => call.name === "updateDeck").map((call) => call.args[1]), [1, 2]);
  });

  it("creates a new account deck on first save and adopts the server's identity", async () => {
    const { account, builder, repository, server } = await signedIn();
    await account.claimStarter("precon_shadow");
    builder.startNew("Night");
    const draftId = builder.draft.id;
    builder.addCard(builder.addableCardIds()[0]);
    const saved = await builder.save();
    assert.equal(saved.ok, true);
    assert.notEqual(saved.value.id, draftId);
    assert.equal(builder.draft.id, saved.value.id);
    assert.equal(builder.hasUnsavedChanges, false);
    assert.equal(repository.list().value.length, 2);
    assert.equal(server.calls.filter((call) => call.name === "createDeck").length, 1);
    assert.equal((await builder.delete(saved.value.id)).ok, true);
    assert.equal(repository.list().value.length, 1);
    assert.equal(server.state.decks.size, 1);
  });

  it("reports a refused claim without changing anything", async () => {
    const { account, server } = await signedIn({ claimed: false });
    assert.equal((await account.claimStarter("precon_harvest")).error.code, "UNKNOWN_STARTER");
    server.fail("claimStarter", "RATE_LIMITED");
    assert.equal((await account.claimStarter("precon_foundry")).error.code, "RATE_LIMITED");
    assert.equal(account.needsStarter, true);
    assert.equal(server.state.copies.length, 0);
  });

  it("does not offer the starter to an account that already took it", async () => {
    const { account } = await signedIn({ claimed: true });
    assert.equal(account.needsStarter, false);
    assert.equal((await account.claimStarter("precon_foundry")).error.code, "STARTER_ALREADY_CLAIMED");
  });

  it("fails visibly when the account cannot be loaded, and recovers on refresh", async () => {
    const { account, identity, server, logger } = setup();
    server.fail("listDecks", "UNAVAILABLE", "the game server is not available");
    identity.become(ALICE);
    await settle();
    assert.equal(account.state.status, AccountStatus.FAILED);
    assert.deepEqual(account.state.error, { code: "UNAVAILABLE", message: "the game server is not available" });
    assert.ok(logger.entries.some((entry) => entry.message === "account could not be loaded"));
    assert.equal((await account.refresh()).ok, true);
    assert.equal(account.state.status, AccountStatus.READY);
  });

  it("forgets the account on sign-out: decks, cards and any open draft", async () => {
    const { account, identity, repository, builder, collection, browserDecks } = await signedIn();
    await account.claimStarter("precon_verdant");
    builder.edit(repository.list().value[0]);
    identity.become(null);
    assert.equal(account.state.status, AccountStatus.SIGNED_OUT);
    assert.equal(builder.draft, null, "the draft belonged to the account");
    assert.equal(collection.state.status, CollectionStatus.SIGNED_OUT);
    assert.equal(collection.ownedCounts(), null);
    assert.equal(repository.storage, DeckStorage.BROWSER);
    assert.deepEqual(repository.list().value, browserDecks.list().value);
    assert.equal((await account.refresh()).error.code, "SIGNED_OUT");
  });

  it("switches accounts without showing the previous player's data", async () => {
    const { account, identity, accountDecks, server } = await signedIn();
    await account.claimStarter("precon_foundry");
    assert.equal(accountDecks.list().value.length, 1);
    const release = server.hold("listDecks");
    identity.become(BOB);
    assert.equal(account.state.account, "bob");
    assert.deepEqual(accountDecks.list().value, [], "alice's decks are gone at once");
    release();
    await settle();
    assert.equal(account.state.status, AccountStatus.READY);
  });

  it("ignores a load that finishes after the player signed out", async () => {
    const { account, identity, accountDecks, collection, server } = setup({ claimed: true });
    server.state.decks.set("00000000-0000-4000-8000-000000000999", { id: "00000000-0000-4000-8000-000000000999", name: "Old", cards: [], version: 1 });
    const release = server.hold("listDecks");
    identity.become(ALICE);
    identity.become(null);
    release();
    await settle();
    assert.equal(account.state.status, AccountStatus.SIGNED_OUT);
    assert.deepEqual(accountDecks.list().value, []);
    assert.equal(collection.state.status, CollectionStatus.SIGNED_OUT);
  });

  it("ignores identity updates that do not change the user", async () => {
    const { account, identity, server } = await signedIn();
    const before = server.calls.length;
    identity.become(ALICE);
    assert.equal(server.calls.length, before);
    assert.equal(account.state.status, AccountStatus.READY);
  });
});

describe("CollectionService", () => {
  it("refuses a claim before the collection is loaded, and a second claim while one runs", async () => {
    const server = fakeCollectionApi({ content });
    const collection = new CollectionService({ api: server.api });
    assert.equal((await collection.claimStarter("precon_foundry")).error.code, CollectionError.NOT_READY);
    await collection.refresh();
    const release = server.hold("claimStarter");
    const first = collection.claimStarter("precon_foundry");
    assert.equal((await collection.claimStarter("precon_foundry")).error.code, CollectionError.BUSY);
    release();
    assert.equal((await first).ok, true);
    assert.equal(collection.hasStarter, true);
  });

  it("counts only active copies as usable in decks", async () => {
    const collection = new CollectionService({
      api: {
        starter: async () => ok({ claimed: true, choices: [] }),
        collection: async () => ok([{ definitionId: "iron_watcher", copies: [{ status: "active" }, { status: "listed" }, { status: "active" }] }]),
      },
    });
    await collection.refresh();
    assert.equal(collection.ownedCounts().get("iron_watcher"), 2);
  });
});

describe("RemoteDeckRepository", () => {
  it("refuses unknown decks and malformed server decks", async () => {
    const server = fakeCollectionApi({ content });
    const decks = new RemoteDeckRepository({ api: server.api });
    assert.equal((await decks.remove("d_nothing")).error.code, RemoteDeckError.NOT_FOUND);
    server.state.decks.set("00000000-0000-4000-8000-000000000001", { id: "00000000-0000-4000-8000-000000000001", name: "Bad", cards: [{ cardId: "Not An Id", count: 1 }], version: 1 });
    assert.equal((await decks.refresh()).error.code, RemoteDeckError.BAD_DECK);
  });

  it("passes a concurrent-edit conflict through and keeps the cache as the server has it", async () => {
    const server = fakeCollectionApi({ content });
    const decks = new RemoteDeckRepository({ api: server.api });
    const created = await decks.save(content.preconDecks[0].withId("custom_1"));
    assert.equal(created.ok, true);
    const serverId = decks.describe(created.value.id).serverId;
    server.state.decks.get(serverId).version = 7;
    const conflict = await decks.save(created.value.withName("Mine"));
    assert.equal(conflict.error.code, "PRECONDITION_FAILED");
    assert.equal(decks.list().value[0].name, content.preconDecks[0].name);
    assert.equal((await decks.refresh()).ok, true);
    assert.equal(decks.describe(created.value.id).version, 7);
  });

  it("reports writes that finish after a sign-out instead of refilling the cache", async () => {
    const server = fakeCollectionApi({ content });
    const decks = new RemoteDeckRepository({ api: server.api });
    const release = server.hold("createDeck");
    const saving = decks.save(content.preconDecks[0].withId("custom_1"));
    decks.clear();
    release();
    assert.equal((await saving).error.code, RemoteDeckError.ACCOUNT_CHANGED);
    assert.deepEqual(decks.list().value, []);
  });
});
