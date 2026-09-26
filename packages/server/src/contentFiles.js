/**
 * Reads everything data-driven the server needs from the repository's
 * data/ directory: the game content bundle, the economy files and the
 * ranked settings. Values
 * are raw JSON here; the modules validate them when the app is composed.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { readContentDirectory } from "./modules/catalog/index.js";
import { parseJson } from "./kernel/json.js";

/**
 * @param {string} path
 * @returns {Promise<unknown>}
 */
const readJson = (path) => readFile(path, "utf8").then((text) => parseJson(text, { maxDepth: 64 }));

/**
 * Every *.json file of a directory, in file name order (stable across machines).
 * @param {string} directory
 */
async function readJsonDirectory(directory) {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map((name) => readJson(join(directory, name))));
}

/**
 * @param {string} dataDirectory
 * @returns {Promise<Readonly<{ raw: import("@magic8/engine/domain/content/GameContent.js").RawContent, starterOffer: unknown, assets: unknown, market: import("./modules/marketplace/index.js").RawMarketData, ranked: unknown }>>}
 */
export async function readServerContent(dataDirectory) {
  const economy = join(dataDirectory, "economy");
  const [raw, starterOffer, assets, rarities, dropTables, pricing, products, ranked] = await Promise.all([
    readContentDirectory(dataDirectory),
    readJson(join(economy, "starter-offer.json")),
    readJson(join(economy, "assets.json")),
    readJson(join(economy, "rarities.json")),
    readJsonDirectory(join(economy, "drop-tables")),
    readJson(join(economy, "pricing.json")),
    readJsonDirectory(join(economy, "products")),
    readJson(join(dataDirectory, "ranked", "ranked.json")),
  ]);
  return Object.freeze({ raw, starterOffer, assets, market: Object.freeze({ rarities, dropTables, pricing, products }), ranked });
}
