/**
 * Content integrity: the bundled data files must pass the same validators the
 * game uses at load time, and the preconstructed decks must be legal.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { CardCatalog } from "../../src/domain/cards/CardCatalog.js";
import { validateCardSet } from "../../src/domain/cards/validateCardDefinition.js";
import { validateDeckRules } from "../../src/domain/decks/DeckRules.js";
import { validateDeck } from "../../src/domain/decks/DeckValidator.js";
import { validateDeckList } from "../../src/domain/decks/validateDeckList.js";
import { createCoreEffectRegistry } from "../../src/domain/effects/registerCoreEffects.js";
import { validateGameRules } from "../../src/domain/game/GameRules.js";

const DATA = resolve(import.meta.dirname, "../../../../data");
const readJson = (relativePath) => JSON.parse(readFileSync(join(DATA, relativePath), "utf8"));

const deckRulesResult = validateDeckRules(readJson("rules/deck-rules.json"));
const gameRulesResult = validateGameRules(readJson("rules/game-rules.json"));

describe("bundled content", () => {
  it("deck-rules.json and game-rules.json are valid", () => {
    assert.equal(deckRulesResult.ok, true, JSON.stringify(deckRulesResult));
    assert.equal(gameRulesResult.ok, true, JSON.stringify(gameRulesResult));
  });

  const cardSets = readdirSync(join(DATA, "cards")).filter((name) => name.endsWith(".cards.json"));
  const context = { factions: deckRulesResult.value.factions, effects: createCoreEffectRegistry() };
  const definitions = cardSets.flatMap((name) => {
    const result = validateCardSet(readJson(`cards/${name}`), context);
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`);
    return result.value;
  });
  const catalogResult = CardCatalog.fromDefinitions(definitions);

  it("card sets validate and form a catalog without duplicate ids", () => {
    assert.equal(catalogResult.ok, true, JSON.stringify(catalogResult));
    assert.ok(catalogResult.value.size >= 20, "expected a reasonable card pool");
  });

  it("every preconstructed deck is structurally valid and legal under the deck rules", () => {
    const deckFiles = readdirSync(join(DATA, "decks")).filter((name) => name.endsWith(".deck.json"));
    assert.ok(deckFiles.length >= 2);
    for (const name of deckFiles) {
      const list = validateDeckList(readJson(`decks/${name}`));
      assert.equal(list.ok, true, `${name}: ${JSON.stringify(list)}`);
      assert.equal(list.value.preconstructed, true, `${name} must be flagged preconstructed`);
      const report = validateDeck(list.value, deckRulesResult.value, catalogResult.value);
      assert.equal(report.valid, true, `${name}: ${JSON.stringify(report.problems)}`);
    }
  });
});
