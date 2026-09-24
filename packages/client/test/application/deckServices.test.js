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

const SINGLE_PLUS_NEUTRAL = Object.freeze({ mode: "single_plus_neutral", neutral: "neutral" });

const content = await loadBundledContent();
/**
 * The same content under the restrictive faction rule, to cover the faction
 * checks. Bundled decks may mix factions (the shipped rule is `any`), so only
 * the single-faction ones are carried over; the others would not load here.
 */
const restricted = await loadBundledContent({
  [ContentResource.DECK_RULES]: { ...bundledResources()[ContentResource.DECK_RULES], factionRule: SINGLE_PLUS_NEUTRAL },
  [ContentResource.PRECON_DECKS]: bundledResources()[ContentResource.PRECON_DECKS].filter((deck) => isSingleFaction(deck, content.catalog)),
});

/**
 * @param {{ faction: string, cards: { cardId: string }[] }} deck raw deck list
 * @param {import("@magic8/engine/domain/cards/CardCatalog.js").CardCatalog} catalog
 */
function isSingleFaction(deck, catalog) {
  return deck.cards.every(({ cardId }) => [deck.faction, SINGLE_PLUS_NEUTRAL.neutral].includes(catalog.get(cardId)?.faction));
}

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
    badDeck[ContentResource.PRECON_DECKS] = [{ schemaVersion: 1, id: "p", name: "P", faction: "ember", preconstructed: true, cards: [{ cardId: "ember_imp", count: 3 }] }];
    const badDeckResult = await loadContent(new StaticContentSource(badDeck), effects);
    assert.equal(badDeckResult.error.code, ContentError.INVALID);
    assert.match(badDeckResult.error.message, /breaks deck rules/);
  });

  it("refuses content whose deck factions cannot reach the minimum deck size", async () => {
    // Under single_plus_neutral: 15 ember cards + 8 neutral = 23 eligible; at one copy each they cannot reach 30.
    const thin = bundledResources();
    thin[ContentResource.DECK_RULES] = { ...thin[ContentResource.DECK_RULES], maxCopies: 1, factionRule: SINGLE_PLUS_NEUTRAL };
    const result = await loadContent(new StaticContentSource(thin), effects);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, ContentError.INVALID);
    assert.match(result.error.message, /faction "ember" has 23 eligible cards; 23 × 1 copies cannot reach the minimum deck size of 30/);
  });

  it("produces a frozen bundle with catalog, rules and precon decks", () => {
    assert.ok(Object.isFrozen(content));
    assert.equal(content.preconDecks.length, 10);
    assert.equal(content.catalog.size, 83);
    assert.equal(content.gameRules.startingLife, 20);
  });
});

describe("DeckBuildingService", () => {
  it("builds a legal deck from scratch, reports progress and saves it", () => {
    const { builder, repository } = services();
    assert.equal(builder.startNew("iron", "Wall Time").ok, true);
    assert.equal(builder.report().valid, false);
    assert.ok(builder.report().problems.some((problem) => problem.code === DeckProblem.TOO_SMALL));
    assert.ok(builder.addableCardIds().includes("iron_watcher"));
    assert.ok(builder.addableCardIds().includes("stone_guardian"), "neutral is allowed");
    assert.ok(builder.addableCardIds().includes("ember_imp"), "the faction is only the deck's theme: every card may go in");
    assert.equal(builder.browse().length, content.catalog.size, "the browser offers the whole catalog");

    for (const cardId of builder.addableCardIds().slice(0, 10)) {
      for (let copy = 0; copy < 3; copy += 1) {
        assert.equal(builder.addCard(cardId).ok, true);
      }
    }
    assert.equal(builder.draft.totalCards, 30);
    assert.equal(builder.report().valid, true);
    assert.equal(builder.hasUnsavedChanges, true);
    const saved = builder.save();
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal(builder.hasUnsavedChanges, false);
    assert.equal(repository.list().value[0].id, "custom_1");
    assert.equal(repository.list().value[0].name, "Wall Time");
  });

  it("enforces copies, size, unknown cards, faction and name rules", () => {
    const { builder } = services(restricted);
    assert.ok(!builder.rules.allowsFaction("ember", "iron"));
    builder.startNew("ember");
    for (let copy = 0; copy < 3; copy += 1) {
      builder.addCard("ember_imp");
    }
    assert.equal(builder.addCard("ember_imp").error.code, DeckBuildingError.LIMIT_REACHED);
    assert.equal(builder.addCard("ghost").error.code, DeckBuildingError.UNKNOWN_CARD);
    assert.equal(builder.addCard("iron_watcher").ok, true, "adding an off-faction card is allowed; the report flags it");
    assert.ok(builder.report().problems.some((problem) => problem.code === DeckProblem.FACTION_MISMATCH));
    assert.equal(builder.rename("").error.code, DeckBuildingError.INVALID_NAME);
    assert.equal(builder.rename("x".repeat(40)).error.code, DeckBuildingError.INVALID_NAME);
    assert.equal(builder.rename("  Burn  ").value.name, "Burn");
    assert.equal(builder.setFaction("water").error.code, DeckBuildingError.INVALID_FACTION);
    assert.equal(builder.setFaction("neutral").error.code, DeckBuildingError.INVALID_FACTION, "the shared pool is not a deck faction");
    assert.equal(builder.startNew("neutral").error.code, DeckBuildingError.INVALID_FACTION);
    assert.equal(services().builder.startNew("neutral").error.code, DeckBuildingError.INVALID_FACTION, "nor a theme to start from when cards are unrestricted");
    assert.equal(builder.setFaction("iron").ok, true);
    assert.ok(!builder.report().problems.some((problem) => problem.code === DeckProblem.FACTION_MISMATCH && problem.cardId === "iron_watcher"));
    assert.equal(builder.removeCard("ember_imp").value.countOf("ember_imp"), 2);
  });

  it("copies preconstructed decks instead of editing them, and caps saved decks", () => {
    const { builder, repository } = services();
    const precon = content.preconDecks[0];
    const draft = builder.edit(precon).value;
    assert.notEqual(draft.id, precon.id);
    assert.equal(draft.preconstructed, false);
    assert.equal(draft.totalCards, precon.totalCards);
    assert.equal(builder.save().ok, true);
    assert.equal(repository.list().value.length, 1);

    for (let index = 2; index <= content.deckRules.maxSavedDecks; index += 1) {
      builder.startNew("ember", `Deck ${index}`);
      assert.equal(builder.save().ok, true);
    }
    builder.startNew("ember", "One too many");
    assert.equal(builder.save().error.code, DeckBuildingError.TOO_MANY_DECKS);
    assert.equal(builder.delete("custom_3").ok, true);
    assert.equal(builder.save().ok, true, "a slot freed up");
  });

  it("refuses operations without a draft", () => {
    const { builder } = services();
    assert.equal(builder.addCard("ember_imp").error.code, DeckBuildingError.NO_DRAFT);
    assert.equal(builder.report(), null);
    assert.deepEqual(builder.addableCardIds(), []);
  });
});

describe("DeckSelectionService", () => {
  it("lists preconstructed decks first, then custom decks with their reports", () => {
    const { builder, selection } = services();
    builder.startNew("iron", "WIP");
    builder.addCard("iron_watcher");
    builder.save();
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
});
