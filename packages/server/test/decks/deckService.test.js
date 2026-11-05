/**
 * DeckService: ownership, drafts, playability, optimistic concurrency, limits.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { AppError } from "../../src/kernel/AppError.js";
import { isUuid, uuidV4 } from "../../src/kernel/random.js";
import { validateHouseDecks } from "../../src/modules/decks/index.js";
import { buildTestApp, deterministicRandom } from "../helpers.js";

const PRINTING = Object.freeze({ edition: "core-1" });
const DATA = resolve(import.meta.dirname, "../../../../data");
/** @param {{ cardId: string }} a @param {{ cardId: string }} b */
const byCard = (a, b) => (a.cardId < b.cardId ? -1 : 1);

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
  return { user, precon, input: { name: precon.name, cards: precon.entries.map((entry) => ({ ...entry })) } };
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

describe("DeckService: the house's decks", () => {
  const houseFile = (name) => JSON.parse(readFileSync(join(DATA, "decks", "house", name), "utf8"));
  const content = (setup) => setup.app.catalog.current().content;

  it("stores a house account's deck among its own, playable without the cards, under the same id every time", async () => {
    const setup = await buildTestApp();
    const bot = await userIn(setup, "gigi.one");
    const file = houseFile("house_ember_stampede.deck.json");
    const [deck] = (await setup.app.decks.list(bot.id)).decks;
    assert.equal(deck.name, file.name);
    assert.equal(deck.playable, true, JSON.stringify(deck.problems));
    assert.ok(isUuid(deck.id));
    assert.deepEqual([...deck.cards].sort(byCard), [...file.cards].sort(byCard));
    assert.deepEqual(await setup.app.decks.get(bot.id, deck.id), deck);
    const list = await setup.app.decks.playableDeckList(bot.id, deck.id);
    assert.equal(list.totalCards, file.cards.reduce((sum, entry) => sum + entry.count, 0));
    assert.deepEqual((await setup.app.decks.list(bot.id)).decks, [deck], "read again: the same deck, not a second one");
    const rows = await setup.database.rows("SELECT id FROM decks WHERE owner_id = $1", [bot.id]);
    assert.deepEqual(rows.map((row) => row.id), [deck.id], "a stored deck: games and the queue refer to it");
  });

  it("brings a stored house deck back in line with its data", async () => {
    const setup = await buildTestApp();
    const bot = await userIn(setup, "gigi.one");
    const [deck] = (await setup.app.decks.list(bot.id)).decks;
    await setup.database.query("UPDATE decks SET name = 'Old name' WHERE id = $1", [deck.id]);
    await setup.database.query("DELETE FROM deck_cards WHERE deck_id = $1 AND definition_id = $2", [deck.id, deck.cards[0].cardId]);
    const [again] = (await setup.app.decks.list(bot.id)).decks;
    assert.equal(again.name, deck.name);
    assert.deepEqual([...again.cards].sort(byCard), [...deck.cards].sort(byCard));
    assert.equal(again.playable, true);
  });

  it("keeps a house deck out of everyone else's hands and out of reach of edits", async () => {
    const setup = await buildTestApp();
    const bot = await userIn(setup, "gigi.one");
    const [deck] = (await setup.app.decks.list(bot.id)).decks;
    const { user, input } = await ownerOfPrecon(setup, "alice");
    assert.deepEqual((await setup.app.decks.list(user.id)).decks, []);
    await assert.rejects(setup.app.decks.get(user.id, deck.id), failsWith("NOT_FOUND"));
    await assert.rejects(setup.app.decks.update(bot.id, deck.id, deck.version, input), failsWith("FORBIDDEN"));
    await assert.rejects(setup.app.decks.remove(bot.id, deck.id), failsWith("FORBIDDEN"));
    assert.equal((await setup.app.decks.get(bot.id, deck.id)).name, deck.name);
  });

  it("gives every bundled house deck to an account, each legal and using cards of the new season", async () => {
    const setup = await buildTestApp();
    const raw = { decks: ["house_ember_stampede", "house_iron_bastion", "house_wildheart_herd"].map((id) => houseFile(`${id}.deck.json`)), accounts: JSON.parse(readFileSync(join(DATA, "decks", "house-decks.json"), "utf8")) };
    const house = validateHouseDecks(raw, content(setup));
    assert.equal(house.ok, true, JSON.stringify(house));
    assert.deepEqual([...house.value.values()].flat().map((deck) => deck.id).sort(), raw.decks.map((deck) => deck.id).sort());
    const seasonTwo = ["pyre_chanter", "forest_blaze", "wildheart_druid", "rootbreak", "foundry_overseer", "cold_iron"];
    for (const deck of raw.decks) {
      assert.ok(deck.cards.some((entry) => seasonTwo.includes(entry.cardId)), `${deck.id} plays a card of the new season`);
    }
  });

  it("refuses an illegal deck, an unknown deck or a malformed account", async () => {
    const setup = await buildTestApp();
    const legal = houseFile("house_iron_bastion.deck.json");
    const accounts = (map) => ({ schemaVersion: 1, accounts: map });
    const tooMany = structuredClone(legal);
    tooMany.cards[0].count = 4;
    const cases = [
      [{ decks: [tooMany], accounts: accounts({}) }, "breaks deck rules"],
      [{ decks: [legal, legal], accounts: accounts({}) }, "another house deck has this id"],
      [{ decks: [legal], accounts: accounts({ "gigi.one": ["house_nothing"] }) }, "is not a house deck"],
      [{ decks: [legal], accounts: accounts({ "Not An Account": [legal.id] }) }, "not an account name"],
      [{ decks: [legal], accounts: accounts({ "gigi.one": [] }) }, "at least 1"],
      [{ decks: [legal], accounts: { accounts: {} } }, "schemaVersion"],
    ];
    for (const [raw, problem] of cases) {
      const house = validateHouseDecks(raw, content(setup));
      assert.equal(house.ok, false);
      assert.ok(house.error.details.problems.some((message) => message.includes(problem)), `${house.error.details.problems} ⊅ ${problem}`);
    }
    assert.equal(validateHouseDecks({ decks: [], accounts: accounts({}) }, content(setup)).value.size, 0, "no house account is fine");
  });
});
