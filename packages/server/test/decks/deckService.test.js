/**
 * DeckService: ownership, drafts, playability, optimistic concurrency, limits.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../../src/kernel/AppError.js";
import { uuidV4 } from "../../src/kernel/random.js";
import { buildTestApp, deterministicRandom } from "../helpers.js";

const PRINTING = Object.freeze({ edition: "core-1", finish: "standard" });

async function userIn(setup, account) {
  return setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)));
}

/** @param {string} code */
const failsWith = (code) => (error) => error instanceof AppError && error.code === code;

/** A user who owns the cards of a bundled preconstructed deck. */
async function ownerOfPrecon(setup, account, deckId = "precon_foundry") {
  const user = await userIn(setup, account);
  const precon = setup.app.catalog.current().content.preconDecks.find((deck) => deck.id === deckId);
  await setup.app.inventory.mint({ ownerId: user.id, items: precon.entries.map((entry) => ({ definitionId: entry.cardId, count: entry.count })), ...PRINTING, origin: { kind: "grant", ref: `test:${account}` } });
  return { user, precon, input: { name: precon.name, faction: precon.faction, cards: precon.entries.map((entry) => ({ ...entry })) } };
}

describe("DeckService: creating", () => {
  it("saves a legal deck of owned cards as playable", async () => {
    const setup = await buildTestApp();
    const { user, input } = await ownerOfPrecon(setup, "alice");
    const deck = await setup.app.decks.create(user.id, input);
    assert.equal(deck.playable, true, JSON.stringify(deck.problems));
    assert.equal(deck.version, 1);
    assert.deepEqual(deck.cards, [...input.cards].sort((a, b) => (a.cardId < b.cardId ? -1 : 1)));
    assert.deepEqual((await setup.app.decks.list(user.id)).decks.map((listed) => listed.id), [deck.id]);
  });

  it("refuses cards the user does not own, saying which", async () => {
    const setup = await buildTestApp();
    const { user, input } = await ownerOfPrecon(setup, "alice");
    const greedy = { ...input, cards: input.cards.map((entry, index) => (index === 0 ? { ...entry, count: entry.count + 1 } : entry)) };
    await assert.rejects(setup.app.decks.create(user.id, greedy), (error) => failsWith("CARDS_NOT_OWNED")(error) && error.details.missing[0].cardId === input.cards[0].cardId);
    await assert.rejects(setup.app.decks.create(user.id, { ...input, cards: [{ cardId: "no_such_card", count: 1 }] }), failsWith("CARDS_NOT_OWNED"));
    const stranger = await userIn(setup, "mallory");
    await assert.rejects(setup.app.decks.create(stranger.id, input), failsWith("CARDS_NOT_OWNED"));
  });

  it("keeps an unfinished deck as a draft that cannot be played yet", async () => {
    const setup = await buildTestApp();
    const { user, input } = await ownerOfPrecon(setup, "alice");
    const draft = await setup.app.decks.create(user.id, { ...input, name: "  Work in progress  ", cards: input.cards.slice(0, 2) });
    assert.equal(draft.name, "Work in progress");
    assert.equal(draft.playable, false);
    assert.ok(draft.problems.some((problem) => problem.code === "TOO_SMALL"));
    await assert.rejects(setup.app.decks.playableDeckList(user.id, draft.id), failsWith("VALIDATION"));
  });

  it("rejects malformed input", async () => {
    const setup = await buildTestApp();
    const { user, input } = await ownerOfPrecon(setup, "alice");
    for (const bad of [
      { ...input, name: "" },
      { ...input, name: "x".repeat(31) },
      { ...input, faction: "Iron!" },
      { ...input, cards: [{ cardId: input.cards[0].cardId, count: 0 }] },
      { ...input, cards: [input.cards[0], input.cards[0]] },
      { ...input, cards: [{ cardId: input.cards[0].cardId, count: 1, extra: true }] },
      { ...input, cards: [{ cardId: input.cards[0].cardId, count: 41 }] },
    ]) {
      await assert.rejects(setup.app.decks.create(user.id, bad), failsWith("VALIDATION"), JSON.stringify(bad).slice(0, 80));
    }
  });

  it("enforces the saved-deck limit", async () => {
    const setup = await buildTestApp();
    const { user, input } = await ownerOfPrecon(setup, "alice");
    const limit = setup.app.catalog.current().content.deckRules.maxSavedDecks;
    for (let index = 0; index < limit; index += 1) {
      await setup.app.decks.create(user.id, { ...input, name: `Deck ${index}` });
    }
    await assert.rejects(setup.app.decks.create(user.id, input), failsWith("LIMIT_REACHED"));
  });
});

describe("DeckService: editing", () => {
  it("updates with the version the editor saw and refuses stale saves", async () => {
    const setup = await buildTestApp();
    const { user, input } = await ownerOfPrecon(setup, "alice");
    const deck = await setup.app.decks.create(user.id, input);
    const renamed = await setup.app.decks.update(user.id, deck.id, 1, { ...input, name: "Renamed" });
    assert.equal(renamed.version, 2);
    assert.equal(renamed.name, "Renamed");
    await assert.rejects(setup.app.decks.update(user.id, deck.id, 1, { ...input, name: "Stale" }), (error) => failsWith("PRECONDITION_FAILED")(error) && error.details.version === 2);
    assert.equal((await setup.app.decks.get(user.id, deck.id)).name, "Renamed");
  });

  it("lets one of two concurrent saves of the same version win", async () => {
    const setup = await buildTestApp();
    const { user, input } = await ownerOfPrecon(setup, "alice");
    const deck = await setup.app.decks.create(user.id, input);
    const saves = await Promise.allSettled(["A", "B"].map((name) => setup.app.decks.update(user.id, deck.id, 1, { ...input, name })));
    assert.deepEqual(saves.map((save) => save.status).sort(), ["fulfilled", "rejected"]);
  });

  it("hides other users' decks and deletes softly", async () => {
    const setup = await buildTestApp();
    const { user, input } = await ownerOfPrecon(setup, "alice");
    const other = await ownerOfPrecon(setup, "bob");
    const deck = await setup.app.decks.create(user.id, input);
    await assert.rejects(setup.app.decks.get(other.user.id, deck.id), failsWith("NOT_FOUND"));
    await assert.rejects(setup.app.decks.update(other.user.id, deck.id, 1, other.input), failsWith("NOT_FOUND"));
    await assert.rejects(setup.app.decks.remove(other.user.id, deck.id), failsWith("NOT_FOUND"));
    await setup.app.decks.remove(user.id, deck.id);
    await assert.rejects(setup.app.decks.get(user.id, deck.id), failsWith("NOT_FOUND"));
    await assert.rejects(setup.app.decks.remove(user.id, deck.id), failsWith("NOT_FOUND"));
    assert.equal((await setup.database.rows("SELECT id FROM decks WHERE deleted_at IS NOT NULL")).length, 1, "the row stays for games that used it");
  });

  it("re-evaluates playability when ownership changes", async () => {
    const setup = await buildTestApp();
    const { user, input } = await ownerOfPrecon(setup, "alice");
    const deck = await setup.app.decks.create(user.id, input);
    await setup.database.query("UPDATE card_instances SET status = 'burned' WHERE id = (SELECT id FROM card_instances WHERE owner_id = $1 AND definition_id = $2 LIMIT 1)", [user.id, input.cards[0].cardId]);
    const after = await setup.app.decks.get(user.id, deck.id);
    assert.equal(after.playable, false);
    assert.deepEqual(after.problems.map((problem) => [problem.code, problem.cardId]), [["NOT_OWNED", input.cards[0].cardId]]);
  });
});
