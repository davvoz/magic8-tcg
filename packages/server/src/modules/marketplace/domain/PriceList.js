/**
 * The price list (data/economy/pricing.json): the one file where the shop's
 * prices are set. The standard catalog is generated from it:
 *
 *   singles  every card of the catalog, priced by its rarity
 *   packs    boosters of cards the buyer does not know in advance, drawn
 *            from a drop table, at a fixed price
 *   decks    every preconstructed deck, priced at the sum of its cards'
 *            single prices
 *
 * What it generates are ordinary product definitions, validated together
 * with the hand-written ones of data/economy/products/ (special offers and
 * retired products). Their ids are stable, so paid orders stay fulfillable
 * when prices change: single_<card>, deck_<deck> and each pack's own id.
 *
 * @typedef {Readonly<{ asset: string, singles: ReadonlyMap<string, number> }>} PriceList singles: rarity → price in the asset's smallest unit
 * @typedef {{
 *   rarities: import("./Rarities.js").Rarities,
 *   catalog: { get: (id: string) => { name: string } | undefined },
 *   decks: ReadonlyMap<string, import("@magic8/engine/domain/decks/DeckList.js").DeckList>,
 *   assets: { find: (asset: string) => { precision: number } | undefined, parse: (asset: string, text: unknown) => number | null, format: (asset: string, units: number) => string },
 * }} PriceListContext
 */
import { Issues, allDefined, checkArrayOf, checkInteger, checkObject, checkString } from "@magic8/engine/shared/validation.js";
import { MAX_QUANTITY } from "./Product.js";

export const ProductKind = Object.freeze({ SINGLE: "single", PACK: "pack", DECK: "deck" });

const FILE_KEYS = Object.freeze(["schemaVersion", "asset", "edition", "singles", "packs", "decks"]);
const SINGLES_KEYS = Object.freeze(["perOrder", "prices"]);
const PACK_KEYS = Object.freeze(["id", "name", "description", "dropTable", "price", "perOrder"]);
const DECKS_KEYS = Object.freeze(["perOrder"]);

/**
 * @param {unknown} raw
 * @param {PriceListContext} context
 * @returns {import("@magic8/engine/shared/Result.js").Ok<Readonly<{ priceList: PriceList, products: readonly unknown[] }>> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function buildPriceList(raw, context) {
  const issues = new Issues();
  const file = checkObject(issues, raw, "pricing", FILE_KEYS);
  if (file === undefined) {
    return issues.toResult(undefined);
  }
  const header = parseHeader(issues, file, context.assets);
  if (header === undefined) {
    return issues.toResult(undefined);
  }
  const { asset, edition, accepted } = header;
  /** @type {(text: unknown, path: string) => number | undefined} */
  const amount = (text, path) => {
    const units = context.assets.parse(asset, text);
    return units === null || units === 0 ? issues.add(path, `expected a positive decimal string with at most ${accepted.precision} decimals`) : units;
  };
  const singles = parseSingles(issues, file.singles, context.rarities, amount);
  const packs = checkArrayOf(issues, file.packs, "pricing.packs", { maxLength: 20, item: (item, path) => parsePack(issues, item, path, amount) });
  const decks = checkObject(issues, file.decks, "pricing.decks", DECKS_KEYS);
  const deckLimit = decks === undefined ? undefined : checkInteger(issues, decks.perOrder, "pricing.decks.perOrder", { min: 1, max: MAX_QUANTITY });
  if (!issues.isEmpty || singles === undefined || packs === undefined || deckLimit === undefined) {
    return issues.toResult(undefined);
  }
  const define = productDefiner({ asset, edition, format: (units) => context.assets.format(asset, units) });
  const products = [
    ...packs.map((pack) => define({ id: pack.id, kind: ProductKind.PACK, name: pack.name, description: pack.description, units: pack.price, content: { type: "pack", ref: pack.dropTable, count: 1 }, perOrder: pack.perOrder })),
    ...deckProducts(context, singles.prices, deckLimit, define),
    ...singleProducts(context, singles, define),
  ];
  return issues.toResult(Object.freeze({ priceList: Object.freeze({ asset, singles: singles.prices }), products: Object.freeze(products) }));
}

/**
 * The schema version, the asset every price is in and the edition singles and decks are minted in.
 * @param {Issues} issues
 * @param {Record<string, unknown>} file
 * @param {PriceListContext["assets"]} assets
 */
function parseHeader(issues, file, assets) {
  checkInteger(issues, file.schemaVersion, "pricing.schemaVersion", { min: 1, max: 1 });
  const asset = checkString(issues, file.asset, "pricing.asset");
  const accepted = asset === undefined ? undefined : assets.find(asset);
  if (asset !== undefined && accepted === undefined) {
    issues.add("pricing.asset", `"${asset}" is not an accepted asset`);
  }
  return allDefined({ asset, accepted, edition: checkString(issues, file.edition, "pricing.edition") });
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {import("./Rarities.js").Rarities} rarities
 * @param {(text: unknown, path: string) => number | undefined} amount
 */
function parseSingles(issues, raw, rarities, amount) {
  const singles = checkObject(issues, raw, "pricing.singles", SINGLES_KEYS);
  if (singles === undefined) {
    return undefined;
  }
  const perOrder = checkInteger(issues, singles.perOrder, "pricing.singles.perOrder", { min: 1, max: MAX_QUANTITY });
  const table = checkObject(issues, singles.prices, "pricing.singles.prices", rarities.order) ?? {};
  /** @type {Map<string, number>} */
  const prices = new Map();
  for (const rarity of rarities.order) {
    const path = `pricing.singles.prices.${rarity}`;
    const price = table[rarity] === undefined ? issues.add(path, "missing: every rarity needs a price, so that every card is on sale") : amount(table[rarity], path);
    if (price !== undefined) {
      prices.set(rarity, price);
    }
  }
  return perOrder === undefined ? undefined : Object.freeze({ perOrder, prices: /** @type {ReadonlyMap<string, number>} */ (prices) });
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @param {(text: unknown, path: string) => number | undefined} amount
 */
function parsePack(issues, raw, path, amount) {
  const pack = checkObject(issues, raw, path, PACK_KEYS);
  if (pack === undefined) {
    return undefined;
  }
  // Shapes (id pattern, lengths, known drop table) are checked with the other products.
  const fields = allDefined({
    id: checkString(issues, pack.id, `${path}.id`),
    name: checkString(issues, pack.name, `${path}.name`),
    description: checkString(issues, pack.description, `${path}.description`),
    dropTable: checkString(issues, pack.dropTable, `${path}.dropTable`),
    price: amount(pack.price, `${path}.price`),
    perOrder: checkInteger(issues, pack.perOrder, `${path}.perOrder`, { min: 1, max: MAX_QUANTITY }),
  });
  return fields === undefined ? undefined : Object.freeze(fields);
}

/**
 * @param {{ asset: string, edition: string, format: (units: number) => string }} list
 */
function productDefiner({ asset, edition, format }) {
  /**
   * A product definition in the shape of data/economy/products/*.json.
   * @param {{ id: string, kind: string, name: string, description: string, units: number, content: Record<string, unknown>, perOrder: number }} fields
   */
  return ({ id, kind, name, description, units, content, perOrder }) =>
    Object.freeze({ schemaVersion: 1, id, kind, name, description, edition, prices: [{ asset, amount: format(units) }], contents: [content], limits: { perOrder }, active: true });
}

/**
 * Every card, one copy at its rarity's price.
 * @param {PriceListContext} context
 * @param {{ perOrder: number, prices: ReadonlyMap<string, number> }} singles
 * @param {ReturnType<typeof productDefiner>} define
 */
function singleProducts({ rarities, catalog }, singles, define) {
  return [...rarities.of.keys()].sort().map((cardId) => {
    const rarity = /** @type {string} */ (rarities.of.get(cardId));
    const units = /** @type {number} */ (singles.prices.get(rarity));
    const name = catalog.get(cardId)?.name ?? cardId;
    return define({ id: `single_${cardId}`, kind: ProductKind.SINGLE, name, description: `One ${rarity} card.`, units, content: { type: "card", ref: cardId, count: 1 }, perOrder: singles.perOrder });
  });
}

/**
 * Every preconstructed deck, at the sum of its cards' single prices.
 * @param {PriceListContext} context
 * @param {ReadonlyMap<string, number>} prices
 * @param {number} perOrder
 * @param {ReturnType<typeof productDefiner>} define
 */
function deckProducts({ rarities, decks }, prices, perOrder, define) {
  return [...decks.values()].map((deck) => {
    const units = deck.entries.reduce((total, entry) => total + entry.count * /** @type {number} */ (prices.get(/** @type {string} */ (rarities.of.get(entry.cardId)))), 0);
    return define({
      id: `deck_${deck.id}`,
      kind: ProductKind.DECK,
      name: deck.name,
      description: `The complete ${deck.name} deck, ${deck.totalCards} cards, saved to your account ready to play. It costs what its cards cost as singles.`,
      units,
      content: { type: "deck", ref: deck.id, count: 1 },
      perOrder,
    });
  });
}
