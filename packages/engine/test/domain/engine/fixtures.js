/**
 * Shared fixtures: real bundled content, real rules, an engine factory.
 * Tests may override rule fields to exercise specific behaviour.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { CardCatalog } from "../../../src/domain/cards/CardCatalog.js";
import { validateCardSet } from "../../../src/domain/cards/validateCardDefinition.js";
import { createCoreCommandRegistry } from "../../../src/domain/commands/registerCoreCommands.js";
import { validateDeckRules } from "../../../src/domain/decks/DeckRules.js";
import { validateDeckList } from "../../../src/domain/decks/validateDeckList.js";
import { createCoreEffectRegistry } from "../../../src/domain/effects/registerCoreEffects.js";
import { GameEngine } from "../../../src/domain/game/GameEngine.js";
import { validateGameRules } from "../../../src/domain/game/GameRules.js";

const DATA = resolve(import.meta.dirname, "../../../../../data");
const readJson = (relativePath) => JSON.parse(readFileSync(join(DATA, relativePath), "utf8"));

/** @param {import("../../../src/shared/Result.js").Ok<unknown> | import("../../../src/shared/Result.js").Fail} result */
function unwrap(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}

export const deckRules = unwrap(validateDeckRules(readJson("rules/deck-rules.json")));
export const effects = createCoreEffectRegistry();
export const catalog = unwrap(
  CardCatalog.fromDefinitions(unwrap(validateCardSet(readJson("cards/core.cards.json"), { factions: deckRules.factions, effects }))),
);
export const emberDeck = unwrap(validateDeckList(readJson("decks/precon_ember.deck.json")));
export const ironDeck = unwrap(validateDeckList(readJson("decks/precon_iron.deck.json")));

export const baseRulesRaw = readJson("rules/game-rules.json");

/** @param {Record<string, unknown>} [overrides] shallow overrides of the top-level rule fields */
export function rulesWith(overrides = {}) {
  return unwrap(validateGameRules({ ...baseRulesRaw, ...overrides }));
}

export const P1 = "p1";
export const P2 = "p2";

/**
 * Creates and starts an engine.
 * @param {{ seed?: number, rules?: import("../../../src/domain/game/GameRules.js").GameRules, commands?: import("../../../src/domain/commands/CommandRegistry.js").CommandRegistry, decks?: [import("../../../src/domain/decks/DeckList.js").DeckList, import("../../../src/domain/decks/DeckList.js").DeckList], start?: boolean }} [options]
 */
export function createEngine(options = {}) {
  const { seed = 42, rules = rulesWith(), commands = createCoreCommandRegistry(), decks = [emberDeck, ironDeck], start = true } = options;
  const engine = unwrap(
    GameEngine.create({
      rules,
      catalog,
      effects,
      commands,
      players: [
        { id: P1, name: "Alice", deckList: decks[0] },
        { id: P2, name: "Bob", deckList: decks[1] },
      ],
      seed,
    }),
  );
  const startResult = start ? engine.start() : null;
  return { engine, startResult };
}

/** @param {import("../../../src/domain/game/GameEngine.js").GameEngine} engine */
export function view(engine) {
  return engine.getSnapshot(null);
}

/** @param {import("../../../src/domain/game/GameEngine.js").GameEngine} engine @param {string} playerId */
export function player(engine, playerId) {
  return view(engine).players.find((candidate) => candidate.id === playerId);
}

/** @param {readonly Readonly<Record<string, unknown>>[]} events @param {string} type */
export function eventsOfType(events, type) {
  return events.filter((event) => event.type === type);
}
