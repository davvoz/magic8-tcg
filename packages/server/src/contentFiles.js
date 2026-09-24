/**
 * Reads everything data-driven the server needs from the repository's
 * data/ directory: the game content bundle and the economy files. Values
 * are raw JSON here; the modules validate them when the app is composed.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { readContentDirectory } from "./modules/catalog/index.js";

/**
 * @param {string} dataDirectory
 * @returns {Promise<Readonly<{ raw: import("@magic8/engine/domain/content/GameContent.js").RawContent, starterOffer: unknown }>>}
 */
export async function readServerContent(dataDirectory) {
  const [raw, starterOffer] = await Promise.all([readContentDirectory(dataDirectory), readFile(join(dataDirectory, "economy", "starter-offer.json"), "utf8").then(JSON.parse)]);
  return Object.freeze({ raw, starterOffer });
}
