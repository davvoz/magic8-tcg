import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CardCatalog } from "../../src/domain/cards/CardCatalog.js";
import { validateCardSet } from "../../src/domain/cards/validateCardDefinition.js";
import { DeckList } from "../../src/domain/decks/DeckList.js";
import { validateDeckRules } from "../../src/domain/decks/DeckRules.js";
import { DeckProblem, validateDeck } from "../../src/domain/decks/DeckValidator.js";
import { factionMix } from "../../src/domain/decks/factionMix.js";
import { validateDeckList } from "../../src/domain/decks/validateDeckList.js";
import { createCoreEffectRegistry } from "../../src/domain/effects/registerCoreEffects.js";

const rulesRaw = () => ({
  schemaVersion: 1,
  minSize: 4,
  maxSize: 6,
  maxCopies: 2,
  allowedTypes: ["creature"],
  factions: ["ember", "iron", "neutral"],
  maxSavedDecks: 10,
  deckNameMaxLength: 12,
});

const rules = validateDeckRules(rulesRaw()).value;

const cardContext = { factions: rules.factions, effects: createCoreEffectRegistry() };
const cards = validateCardSet(
  {
    schemaVersion: 1,
    cards: [
      { id: "ember_imp", name: "Ember Imp", type: "creature", faction: "ember", cost: 1, attack: 2, health: 1 },
      { id: "scrap_golem", name: "Scrap Golem", type: "creature", faction: "iron", cost: 1, attack: 1, health: 2 },
      { id: "sellsword", name: "Sellsword", type: "creature", faction: "neutral", cost: 3, attack: 3, health: 3 },
      { id: "bolt", name: "Bolt", type: "spell", faction: "ember", cost: 1 },
    ],
  },
  cardContext,
).value;
const catalog = CardCatalog.fromDefinitions(cards).value;

const deckRaw = () => ({
  schemaVersion: 1,
  id: "my_deck",
  name: "My Deck",
  cards: [
    { cardId: "ember_imp", count: 2 },
    { cardId: "sellsword", count: 2 },
  ],
});

describe("validateDeckList", () => {
  it("accepts a well-formed list and defaults preconstructed to false", () => {
    const result = validateDeckList(deckRaw());
    assert.equal(result.ok, true);
    assert.equal(result.value.preconstructed, false);
    assert.equal(result.value.totalCards, 4);
    assert.ok(Object.isFrozen(result.value.entries));
  });

  it("rejects duplicates, bad counts, bad ids and unknown fields", () => {
    const duplicate = deckRaw();
    duplicate.cards.push({ cardId: "ember_imp", count: 1 });
    assert.equal(validateDeckList(duplicate).ok, false);

    const zero = deckRaw();
    zero.cards[0].count = 0;
    assert.equal(validateDeckList(zero).ok, false);

    const badId = deckRaw();
    badId.cards[0].cardId = "../../etc";
    assert.equal(validateDeckList(badId).ok, false);

    assert.equal(validateDeckList({ ...deckRaw(), hacker: 1 }).ok, false);
  });

  it("reads and drops the faction lists carried before decks lost theirs", () => {
    const legacy = validateDeckList({ ...deckRaw(), faction: "ember" });
    assert.equal(legacy.ok, true);
    assert.equal("faction" in legacy.value, false);
    assert.equal("faction" in legacy.value.toPlain(), false);
  });

  it("requires schemaVersion for files but not for embedded lists", () => {
    const embedded = deckRaw();
    delete embedded.schemaVersion;
    assert.equal(validateDeckList(embedded).ok, false);
    assert.equal(validateDeckList(embedded, { requireSchemaVersion: false }).ok, true);
  });

  it("rejects prototype-polluting keys in entries", () => {
    const raw = deckRaw();
    raw.cards = [JSON.parse('{"cardId":"ember_imp","count":1,"__proto__":{"count":99}}')];
    assert.equal(validateDeckList(raw).ok, false);
  });
});

describe("DeckList operations", () => {
  const base = validateDeckList(deckRaw()).value;

  it("adds, increments and removes copies immutably", () => {
    const added = base.withCardAdded("scrap_golem").withCardAdded("scrap_golem");
    assert.equal(added.countOf("scrap_golem"), 2);
    assert.equal(base.countOf("scrap_golem"), 0);
    const removed = added.withCardRemoved("scrap_golem").withCardRemoved("scrap_golem").withCardRemoved("scrap_golem");
    assert.equal(removed.countOf("scrap_golem"), 0);
    assert.equal(removed.entries.some((entry) => entry.cardId === "scrap_golem"), false);
  });

  it("round-trips through toPlain and validateDeckList", () => {
    const plain = base.withName("Renamed").toPlain();
    const again = validateDeckList(plain, { requireSchemaVersion: false });
    assert.equal(again.ok, true);
    assert.equal(again.value.name, "Renamed");
    assert.deepEqual(again.value.toPlain(), plain);
  });
});

describe("validateDeckRules", () => {
  it("reads and ignores the faction rule of content published before decks lost their faction", () => {
    const legacy = validateDeckRules({ ...rulesRaw(), factionRule: { mode: "any", neutral: "neutral" } });
    assert.equal(legacy.ok, true);
    assert.equal("factionRule" in legacy.value, false);
    assert.deepEqual(legacy.value.factions, ["ember", "iron", "neutral"]);
  });

  it("rejects maxSize below minSize and unknown card types", () => {
    assert.equal(validateDeckRules({ ...rulesRaw(), maxSize: 3 }).ok, false);
    assert.equal(validateDeckRules({ ...rulesRaw(), allowedTypes: ["land"] }).ok, false);
  });
});

describe("validateDeck (rule level)", () => {
  it("accepts a valid deck", () => {
    const report = validateDeck(validateDeckList(deckRaw()).value, rules, catalog);
    assert.deepEqual(report, { valid: true, problems: [] });
  });

  it("reports every problem at once", () => {
    const raw = deckRaw();
    raw.name = "A name that is far too long";
    raw.cards = [
      { cardId: "ember_imp", count: 3 },
      { cardId: "bolt", count: 1 },
      { cardId: "ghost", count: 1 },
      { cardId: "scrap_golem", count: 2 },
    ];
    const report = validateDeck(validateDeckList(raw).value, rules, catalog);
    const codes = report.problems.map((problem) => problem.code);
    assert.equal(report.valid, false);
    assert.ok(codes.includes(DeckProblem.TOO_LARGE));
    assert.ok(codes.includes(DeckProblem.NAME_TOO_LONG));
    assert.ok(codes.includes(DeckProblem.TOO_MANY_COPIES));
    assert.ok(codes.includes(DeckProblem.TYPE_NOT_ALLOWED));
    assert.ok(codes.includes(DeckProblem.UNKNOWN_CARD));
    assert.equal(report.problems.find((p) => p.code === DeckProblem.UNKNOWN_CARD).cardId, "ghost");
  });

  it("reports TOO_SMALL", () => {
    const deck = new DeckList({ id: "x", name: "x", entries: [{ cardId: "ember_imp", count: 1 }] });
    const codes = validateDeck(deck, rules, catalog).problems.map((problem) => problem.code);
    assert.deepEqual(codes, [DeckProblem.TOO_SMALL]);
  });

  it("lets cards of every faction share a deck", () => {
    const deck = new DeckList({ id: "x", name: "x", entries: [{ cardId: "ember_imp", count: 2 }, { cardId: "scrap_golem", count: 1 }, { cardId: "sellsword", count: 1 }] });
    assert.deepEqual(validateDeck(deck, rules, catalog), { valid: true, problems: [] });
  });
});

describe("factionMix", () => {
  it("counts copies per faction in the rules' order, leaving out empty factions and unknown cards", () => {
    const entries = [{ cardId: "sellsword", count: 1 }, { cardId: "scrap_golem", count: 2 }, { cardId: "ghost", count: 3 }];
    assert.deepEqual(factionMix(entries, catalog, rules.factions), [{ faction: "iron", count: 2 }, { faction: "neutral", count: 1 }]);
    assert.deepEqual(factionMix([], catalog, rules.factions), []);
  });
});
