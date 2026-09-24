/**
 * Reads the raw content bundle from the repository's data/ directory:
 * card sets and preconstructed decks sorted by file name, plus the rules.
 * Nothing is validated here; CatalogService does that with the engine.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * @param {string} directory
 * @param {string} suffix
 */
async function readAll(directory, suffix) {
  const names = (await readdir(directory)).filter((name) => name.endsWith(suffix)).sort();
  return Promise.all(names.map((name) => readJson(join(directory, name))));
}

/** @param {string} path */
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`content file ${path} could not be read: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/**
 * @param {string} dataDirectory
 * @returns {Promise<import("@magic8/engine/domain/content/GameContent.js").RawContent>}
 */
export async function readContentDirectory(dataDirectory) {
  const [cardSets, preconDecks, gameRules, deckRules] = await Promise.all([
    readAll(join(dataDirectory, "cards"), ".cards.json"),
    readAll(join(dataDirectory, "decks"), ".deck.json"),
    readJson(join(dataDirectory, "rules", "game-rules.json")),
    readJson(join(dataDirectory, "rules", "deck-rules.json")),
  ]);
  return Object.freeze({ cardSets, preconDecks, gameRules, deckRules });
}
