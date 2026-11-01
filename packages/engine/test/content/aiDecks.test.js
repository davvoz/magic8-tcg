/**
 * The AI's own decks (data/decks/ai/): every bundled one legal and apart
 * from the preconstructed decks, and a file that is not refused whole.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { buildAiDecks } from "../../src/domain/content/AiDecks.js";
import { buildGameContent } from "../../src/domain/content/GameContent.js";
import { createCoreEffectRegistry } from "../../src/domain/effects/registerCoreEffects.js";

const DATA = resolve(import.meta.dirname, "../../../../data");
const readJson = (relativePath) => JSON.parse(readFileSync(join(DATA, relativePath), "utf8"));
const listJson = (directory, suffix) => readdirSync(join(DATA, directory)).filter((name) => name.endsWith(suffix)).sort().map((name) => readJson(`${directory}/${name}`));
const built = buildGameContent(
  { cardSets: listJson("cards", ".cards.json"), preconDecks: listJson("decks", ".deck.json"), gameRules: readJson("rules/game-rules.json"), deckRules: readJson("rules/deck-rules.json") },
  createCoreEffectRegistry(),
);
const content = /** @type {any} */ (built).value;
const bundled = listJson("decks/ai", ".deck.json");
/** One of the bundled files, to break. */
const copy = () => structuredClone(bundled[0]);

describe("buildAiDecks", () => {
  it("reads every bundled AI deck: legal, its id its own, and not one of the preconstructed decks", () => {
    const decks = buildAiDecks(bundled, content);
    assert.equal(decks.ok, true, JSON.stringify(decks));
    assert.equal(decks.value.length, 10);
    const precons = new Set(content.preconDecks.map((deck) => deck.id));
    assert.ok(decks.value.every((deck) => !precons.has(deck.id) && deck.id.startsWith("ai_")));
  });

  it("refuses the whole list over an illegal deck, a taken id or a malformed file", () => {
    const tooMany = copy();
    tooMany.cards[0].count = 4;
    const taken = copy();
    taken.id = "precon_ember";
    const cases = [
      [[tooMany], "breaks deck rules"],
      [[taken], "another deck has this id"],
      [[copy(), copy()], "another deck has this id"],
      [[{ id: "ai_nothing" }], "aiDecks[0]"],
      [{}, "must be an array"],
    ];
    for (const [raw, problem] of cases) {
      const decks = buildAiDecks(raw, content);
      assert.equal(decks.ok, false);
      assert.ok(decks.error.message.includes(problem), `${decks.error.message} ⊅ ${problem}`);
    }
    assert.deepEqual(buildAiDecks([], content).value, [], "none is fine: the preconstructed decks stand in");
  });
});
