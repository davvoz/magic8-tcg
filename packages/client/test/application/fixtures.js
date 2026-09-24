/** Application-level fixtures: validated content from the bundled data files. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadContent } from "../../src/application/content/ContentService.js";
import { ContentResource } from "../../src/application/ports/ContentSource.contract.js";
import { createCoreEffectRegistry } from "@magic8/engine/domain/effects/registerCoreEffects.js";
import { StaticContentSource } from "../../src/infrastructure/config/StaticContentSource.js";

const DATA = resolve(import.meta.dirname, "../../../../data");
const readJson = (relativePath) => JSON.parse(readFileSync(join(DATA, relativePath), "utf8"));
const listJson = (directory, suffix) =>
  readdirSync(join(DATA, directory))
    .filter((name) => name.endsWith(suffix))
    .sort()
    .map((name) => readJson(`${directory}/${name}`));

/** Raw resources exactly as the browser would fetch them. */
export function bundledResources() {
  return {
    [ContentResource.CARD_SETS]: listJson("cards", ".cards.json"),
    [ContentResource.PRECON_DECKS]: listJson("decks", ".deck.json"),
    [ContentResource.GAME_RULES]: readJson("rules/game-rules.json"),
    [ContentResource.DECK_RULES]: readJson("rules/deck-rules.json"),
  };
}

export const effects = createCoreEffectRegistry();

/** @param {Record<string, unknown>} [overrides] raw resource overrides */
export async function loadBundledContent(overrides = {}) {
  const result = await loadContent(new StaticContentSource({ ...bundledResources(), ...overrides }), effects);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}
