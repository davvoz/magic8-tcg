import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ContentError, loadContent } from "../../src/application/content/ContentService.js";
import { DeckBuildingError, DeckBuildingService } from "../../src/application/decks/DeckBuildingService.js";
import { DeckSelectionService, DeckSource } from "../../src/application/decks/DeckSelectionService.js";
import { ContentResource } from "../../src/application/ports/ContentSource.contract.js";
import { DeckProblem } from "@magic8/engine/domain/decks/DeckValidator.js";
import { StaticContentSource } from "../../src/infrastructure/config/StaticContentSource.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { StoredDeckRepository } from "../../src/infrastructure/persistence/StoredDeckRepository.js";
import { bundledResources, effects, loadBundledContent } from "./fixtures.js";

const content = await loadBundledContent();

function services(bundle = content) {
  const logger = new MemoryLogger();
  const repository = new StoredDeckRepository({ store: new InMemoryStore(), logger });
  return {
    logger,
    repository,
    builder: new DeckBuildingService({ content: bundle, repository }),
    selection: new DeckSelectionService({ content: bundle, repository, logger }),
  };
}

describe("ContentService", () => {
  it("fails on a missing resource, an invalid card and an illegal preconstructed deck", async () => {
    const missing = await loadContent(new StaticContentSource({}), effects);
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, ContentError.LOAD_FAILED);

    const badCard = bundledResources();
    badCard[ContentResource.CARD_SETS] = [{ schemaVersion: 1, cards: [{ id: "x", name: "X", type: "creature", faction: "ember", cost: 1, attack: 1, health: 1, abilities: [{ trigger: "on_play", effect: "nuke" }] }] }];
    const badCardResult = await loadContent(new StaticContentSource(badCard), effects);
    assert.equal(badCardResult.error.code, ContentError.INVALID);
    assert.match(badCardResult.error.message, /cardSets\[0\]/);

    const badDeck = bundledResources();
    badDeck[ContentResource.PRECON_DECKS] = [{ schemaVersion: 1, id: "p", name: "P", preconstructed: true, cards: [{ cardId: "ember_imp", count: 3 }] }];
    const badDeckResult = await loadContent(new StaticContentSource(badDeck), effects);
    assert.equal(badDeckResult.error.code, ContentError.INVALID);
    assert.match(badDeckResult.error.message, /breaks deck rules/);
  });

  it("still loads content published when decks had a faction", async () => {
    const legacy = bundledResources();
    legacy[ContentResource.DECK_RULES] = { ...legacy[ContentResource.DECK_RULES], factionRule: { mode: "any", neutral: "neutral" } };
    legacy[ContentResource.PRECON_DECKS] = legacy[ContentResource.PRECON_DECKS].map((deck) => ({ ...deck, faction: "iron" }));
    const result = await loadContent(new StaticContentSource(legacy), effects);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(result.value.preconDecks.length, 10);
  });

  it("produces a frozen bundle with catalog, rules and precon decks", () => {
    assert.ok(Object.isFrozen(content));
    assert.equal(content.preconDecks.length, 10);
    assert.equal(content.catalog.size, 93);
    assert.equal(content.gameRules.startingLife, 20);
  });
});

describe("DeckBuildingService", () => {
  it("builds a legal deck from scratch, reports progress and saves it", async () => {
    const { builder, repository } = services();
    assert.equal(builder.startNew("Wall Time").ok, true);
    assert.equal(builder.report().valid, false);
    assert.ok(builder.report().problems.some((problem) => problem.code === DeckProblem.TOO_SMALL));
    assert.ok(builder.addableCardIds().includes("iron_watcher"));
    assert.ok(builder.addableCardIds().includes("stone_guardian"));
    assert.ok(builder.addableCardIds().includes("ember_imp"), "a deck has no faction: every card may go in");
    assert.equal(builder.browse().length, content.catalog.size, "the browser offers the whole catalog");

    for (const cardId of builder.addableCardIds().slice(0, 10)) {
      for (let copy = 0; copy < 3; copy += 1) {
        assert.equal(builder.addCard(cardId).ok, true);
      }
    }
    assert.equal(builder.draft.totalCards, 30);
    assert.equal(builder.report().valid, true);
    assert.equal(builder.hasUnsavedChanges, true);
    const saved = await builder.save();
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal(builder.hasUnsavedChanges, false);
    assert.equal(repository.list().value[0].id, "custom_1");
    assert.equal(repository.list().value[0].name, "Wall Time");
  });

  it("enforces copies, size, unknown cards and name rules", () => {
    const { builder } = services();
    builder.startNew();
    for (let copy = 0; copy < 3; copy += 1) {
      builder.addCard("ember_imp");
    }
    assert.equal(builder.addCard("ember_imp").error.code, DeckBuildingError.LIMIT_REACHED);
    assert.equal(builder.addCard("ghost").error.code, DeckBuildingError.UNKNOWN_CARD);
    assert.equal(builder.addCard("iron_watcher").ok, true);
    assert.ok(builder.report().problems.every((problem) => problem.code === DeckProblem.TOO_SMALL), "cards of any faction mix freely");
    assert.equal(builder.rename("").error.code, DeckBuildingError.INVALID_NAME);
    assert.equal(builder.rename("x".repeat(40)).error.code, DeckBuildingError.INVALID_NAME);
    assert.equal(builder.rename("  Burn  ").value.name, "Burn");
    assert.equal(builder.removeCard("ember_imp").value.countOf("ember_imp"), 2);
  });

  it("tells the draft's faction mix as cards come and go", () => {
    const { builder } = services();
    assert.deepEqual(builder.mix(), [], "no draft, no mix");
    builder.startNew();
    assert.deepEqual(builder.mix(), []);
    builder.addCard("stone_guardian");
    builder.addCard("iron_watcher");
    builder.addCard("ember_imp");
    builder.addCard("ember_imp");
    assert.deepEqual(builder.mix(), [{ faction: "ember", count: 2 }, { faction: "iron", count: 1 }, { faction: "neutral", count: 1 }], "in the rules' faction order");
    builder.removeCard("iron_watcher");
    assert.deepEqual(builder.mix(), [{ faction: "ember", count: 2 }, { faction: "neutral", count: 1 }]);
  });

  it("copies preconstructed decks instead of editing them, and caps saved decks", async () => {
    const { builder, repository } = services();
    const precon = content.preconDecks[0];
    const draft = builder.edit(precon).value;
    assert.notEqual(draft.id, precon.id);
    assert.equal(draft.preconstructed, false);
    assert.equal(draft.totalCards, precon.totalCards);
    assert.equal((await builder.save()).ok, true);
    assert.equal(repository.list().value.length, 1);

    for (let index = 2; index <= content.deckRules.maxSavedDecks; index += 1) {
      builder.startNew(`Deck ${index}`);
      assert.equal((await builder.save()).ok, true);
    }
    builder.startNew("One too many");
    assert.equal((await builder.save()).error.code, DeckBuildingError.TOO_MANY_DECKS);
    assert.equal((await builder.delete("custom_3")).ok, true);
    assert.equal((await builder.save()).ok, true, "a slot freed up");
  });

  it("refuses operations without a draft", () => {
    const { builder } = services();
    assert.equal(builder.addCard("ember_imp").error.code, DeckBuildingError.NO_DRAFT);
    assert.equal(builder.report(), null);
    assert.deepEqual(builder.addableCardIds(), []);
  });
});

describe("DeckSelectionService", () => {
  it("lists preconstructed decks first, then custom decks with their reports", async () => {
    const { builder, selection } = services();
    builder.startNew("WIP");
    builder.addCard("iron_watcher");
    await builder.save();
    const options = selection.listDecks();
    assert.deepEqual(
      options.map((option) => [option.source, option.report.valid]),
      [
        ...content.preconDecks.map(() => [DeckSource.PRECONSTRUCTED, true]),
        [DeckSource.CUSTOM, false],
      ],
    );
    assert.equal(selection.listPlayableDecks().length, content.preconDecks.length);
    assert.equal(selection.find("custom_1").deck.name, "WIP");
    assert.equal(selection.find("nope"), undefined);
  });

  it("leaves the preconstructed decks out of the player's decks when they are not theirs, but keeps them as rivals", async () => {
    const logger = new MemoryLogger();
    const repository = new StoredDeckRepository({ store: new InMemoryStore(), logger });
    let signedIn = true;
    const selection = new DeckSelectionService({ content, repository, logger, showPreconstructed: () => !signedIn });
    const builder = new DeckBuildingService({ content, repository });
    builder.edit(content.preconDecks[0]);
    await builder.save();
    assert.deepEqual(selection.listDecks().map((option) => option.source), [DeckSource.CUSTOM], "signed in: only the account's decks");
    assert.equal(selection.listRivalDecks().length, content.preconDecks.length, "the AI still plays the preconstructed decks");
    assert.ok(selection.listRivalDecks().every((option) => option.source === DeckSource.PRECONSTRUCTED));
    signedIn = false;
    assert.equal(selection.listDecks().length, content.preconDecks.length + 1, "offline: the preconstructed decks are the player's too");
  });
});
