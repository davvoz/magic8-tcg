/**
 * Everything the marketplace sells, validated together at startup: card
 * rarities, drop tables resolved into card pools, products. A bad data file
 * stops the server instead of selling something broken.
 *
 * @typedef {Readonly<{
 *   rarities: import("./Rarities.js").Rarities,
 *   dropTables: ReadonlyMap<string, import("./DropTables.js").ResolvedDropTable>,
 *   products: ReadonlyMap<string, import("./Product.js").Product>,
 *   decks: ReadonlyMap<string, import("@magic8/engine/domain/decks/DeckList.js").DeckList>,
 * }>} MarketCatalog
 * @typedef {Readonly<{ rarities: unknown, dropTables: readonly unknown[], products: readonly unknown[] }>} RawMarketData
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { resolveDropTables } from "./DropTables.js";
import { validateProducts } from "./Product.js";
import { validateRarities } from "./Rarities.js";

/**
 * @param {RawMarketData} raw
 * @param {import("@magic8/engine/domain/content/GameContent.js").GameContent} content
 * @param {import("../../economy/index.js").AssetRegistry} assets
 * @returns {import("@magic8/engine/shared/Result.js").Ok<MarketCatalog> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function buildMarketCatalog(raw, content, assets) {
  const rarities = validateRarities(raw.rarities, content.catalog);
  if (!rarities.ok) {
    return fail(rarities.error.code, `rarities: ${rarities.error.message}`, rarities.error.details);
  }
  const dropTables = resolveDropTables(raw.dropTables, rarities.value);
  if (!dropTables.ok) {
    return fail(dropTables.error.code, `drop tables: ${dropTables.error.message}`, dropTables.error.details);
  }
  const decks = new Map(content.preconDecks.map((deck) => [deck.id, deck]));
  const products = validateProducts(raw.products, { catalog: content.catalog, decks, dropTables: dropTables.value, assets });
  if (!products.ok) {
    return fail(products.error.code, `products: ${products.error.message}`, products.error.details);
  }
  return ok(Object.freeze({ rarities: rarities.value, dropTables: dropTables.value, products: products.value, decks }));
}
