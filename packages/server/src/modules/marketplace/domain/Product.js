/**
 * Products: generated from the price list (singles, packs, decks: see
 * PriceList.js) or written by hand (data/economy/products/*.json: special
 * offers, retired products), validated together at startup against the
 * content, the accepted assets and the drop tables. `kind` is a
 * presentation label only; what a product gives is its `contents`, expanded
 * recursively (a bundle is a product made of products). A new kind of
 * product is usually just a new file (docs/tcg/01-architettura.md §7.2).
 * Besides cards, a product may give entries to paid game modes (`entry`,
 * whose `ref` is the kind: ranked), credited by the entries module.
 *
 * @typedef {"card" | "pack" | "deck" | "product" | "entry"} ContentType
 * @typedef {Readonly<{ type: ContentType, ref: string, count: number }>} ProductContent
 * @typedef {Readonly<{ perOrder: number, availableFrom: number | null, availableUntil: number | null }>} ProductLimits
 * @typedef {Readonly<{
 *   id: string, kind: string, name: string, description: string, edition: string,
 *   prices: ReadonlyMap<string, number>, contents: readonly ProductContent[],
 *   limits: ProductLimits, active: boolean, cardsPerUnit: number,
 * }>} Product
 * @typedef {Readonly<{
 *   cards: readonly Readonly<{ definitionId: string, count: number }>[],
 *   packs: readonly string[],
 *   decks: readonly string[],
 *   entries: readonly Readonly<{ kind: string, count: number }>[],
 * }>} Expansion what one order line gives: cards to mint, packs to open (drop table ids, one per pack), decks to mint and save (deck ids, one per deck), entries to credit (by kind)
 */
import { Issues, checkArrayOf, checkBoolean, checkEnum, checkInteger, checkObject, checkString } from "@magic8/engine/shared/validation.js";

export const ContentType = Object.freeze({ CARD: "card", PACK: "pack", DECK: "deck", PRODUCT: "product", ENTRY: "entry" });
/** Most cards one order may mint: keeps a single fulfilment transaction bounded. */
export const MAX_CARDS_PER_ORDER = 1000;
export const MAX_QUANTITY = 100;

const PRODUCT_KEYS = Object.freeze(["schemaVersion", "id", "kind", "name", "description", "edition", "prices", "contents", "limits", "active"]);
/** The printing a product's cards and decks are minted in; packs mint in their drop table's edition. */
const EDITION_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const PRICE_KEYS = Object.freeze(["asset", "amount"]);
const CONTENT_KEYS = Object.freeze(["type", "ref", "count"]);
const LIMIT_KEYS = Object.freeze(["perOrder", "availableFrom", "availableUntil"]);
const ID_PATTERN = /^[a-z0-9_]{1,40}$/;
const KIND_PATTERN = /^[a-z][a-z0-9_]{0,23}$/;
const MAX_DEPTH = 4;

/**
 * @typedef {{
 *   catalog: { has: (id: string) => boolean },
 *   decks: ReadonlyMap<string, { totalCards: number }>,
 *   dropTables: ReadonlyMap<string, { size: number }>,
 *   assets: { find: (asset: string) => { precision: number } | undefined, parse: (asset: string, text: unknown) => number | null },
 *   entryKinds?: readonly string[],
 * }} ProductContext `entryKinds`: the kinds of entry a product may give (none by default)
 */

/**
 * @param {readonly unknown[]} rawProducts
 * @param {ProductContext} context
 * @returns {import("@magic8/engine/shared/Result.js").Ok<ReadonlyMap<string, Product>> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function validateProducts(rawProducts, context) {
  const issues = new Issues();
  /** @type {Map<string, Omit<Product, "cardsPerUnit">>} */
  const parsed = new Map();
  rawProducts.forEach((raw, index) => {
    const product = parseProduct(issues, raw, `products[${index}]`, context);
    if (product === undefined) {
      return;
    }
    if (parsed.has(product.id)) {
      issues.add(`products[${index}].id`, `duplicate product "${product.id}"`);
      return;
    }
    parsed.set(product.id, product);
  });
  /** @type {Map<string, Product>} */
  const products = new Map();
  const scope = { products: parsed, context, issues };
  for (const product of parsed.values()) {
    const cards = cardsOf(product, [], scope);
    if (cards !== undefined) {
      products.set(product.id, Object.freeze({ ...product, cardsPerUnit: cards }));
    }
  }
  return issues.toResult(/** @type {ReadonlyMap<string, Product>} */ (products));
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @param {ProductContext} context
 */
function parseProduct(issues, raw, path, context) {
  const object = checkObject(issues, raw, path, PRODUCT_KEYS);
  if (object === undefined) {
    return undefined;
  }
  const before = issues.count;
  checkInteger(issues, object.schemaVersion, `${path}.schemaVersion`, { min: 1, max: 1 });
  const id = checkString(issues, object.id, `${path}.id`, { pattern: ID_PATTERN });
  const kind = checkString(issues, object.kind, `${path}.kind`, { pattern: KIND_PATTERN });
  const name = checkString(issues, object.name, `${path}.name`, { minLength: 1, maxLength: 64 });
  const description = checkString(issues, object.description, `${path}.description`, { maxLength: 400 });
  const edition = checkString(issues, object.edition, `${path}.edition`, { pattern: EDITION_PATTERN });
  const active = checkBoolean(issues, object.active, `${path}.active`);
  const prices = parsePrices(issues, object.prices, `${path}.prices`, context);
  const contents = checkArrayOf(issues, object.contents, `${path}.contents`, { minLength: 1, maxLength: 20, item: (item, itemPath) => parseContent(issues, item, itemPath, context) });
  const limits = parseLimits(issues, object.limits, `${path}.limits`);
  if (issues.count > before) {
    return undefined;
  }
  return Object.freeze({
    id: /** @type {string} */ (id),
    kind: /** @type {string} */ (kind),
    name: /** @type {string} */ (name),
    description: /** @type {string} */ (description),
    edition: /** @type {string} */ (edition),
    prices: /** @type {ReadonlyMap<string, number>} */ (prices),
    contents: Object.freeze(/** @type {ProductContent[]} */ (contents)),
    limits: /** @type {ProductLimits} */ (limits),
    active: /** @type {boolean} */ (active),
  });
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @param {ProductContext} context
 */
function parsePrices(issues, raw, path, context) {
  /** @type {Map<string, number>} */
  const prices = new Map();
  checkArrayOf(issues, raw, path, {
    minLength: 1,
    maxLength: 10,
    item: (item, itemPath) => {
      const price = checkObject(issues, item, itemPath, PRICE_KEYS);
      const asset = price === undefined ? undefined : checkString(issues, price.asset, `${itemPath}.asset`);
      if (price === undefined || asset === undefined) {
        return undefined;
      }
      const accepted = context.assets.find(asset);
      if (accepted === undefined) {
        return issues.add(`${itemPath}.asset`, `"${asset}" is not an accepted asset`);
      }
      const amount = context.assets.parse(asset, price.amount);
      if (amount === null || amount === 0) {
        return issues.add(`${itemPath}.amount`, `expected a positive decimal string with at most ${accepted.precision} decimals`);
      }
      if (prices.has(asset)) {
        return issues.add(itemPath, `duplicate price in ${asset}`);
      }
      prices.set(asset, amount);
      return amount;
    },
  });
  return prices;
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @param {ProductContext} context
 * @returns {ProductContent | undefined}
 */
function parseContent(issues, raw, path, context) {
  const content = checkObject(issues, raw, path, CONTENT_KEYS);
  if (content === undefined) {
    return undefined;
  }
  const type = checkEnum(issues, content.type, `${path}.type`, Object.values(ContentType));
  const ref = checkString(issues, content.ref, `${path}.ref`, { pattern: ID_PATTERN });
  const count = checkInteger(issues, content.count, `${path}.count`, { min: 1, max: MAX_CARDS_PER_ORDER });
  if (type === undefined || ref === undefined || count === undefined) {
    return undefined;
  }
  const known = {
    [ContentType.CARD]: () => context.catalog.has(ref),
    [ContentType.PACK]: () => context.dropTables.has(ref),
    [ContentType.DECK]: () => context.decks.has(ref),
    [ContentType.PRODUCT]: () => true, // checked once every product is parsed
    [ContentType.ENTRY]: () => (context.entryKinds ?? []).includes(ref),
  }[type]();
  if (!known) {
    return issues.add(`${path}.ref`, `unknown ${type} "${ref}"`);
  }
  return Object.freeze({ type, ref, count });
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @returns {ProductLimits | undefined}
 */
function parseLimits(issues, raw, path) {
  const limits = checkObject(issues, raw, path, LIMIT_KEYS);
  if (limits === undefined) {
    return undefined;
  }
  const perOrder = checkInteger(issues, limits.perOrder, `${path}.perOrder`, { min: 1, max: MAX_QUANTITY });
  const availableFrom = parseInstant(issues, limits.availableFrom, `${path}.availableFrom`);
  const availableUntil = parseInstant(issues, limits.availableUntil, `${path}.availableUntil`);
  if (availableFrom !== null && availableUntil !== null && availableFrom !== undefined && availableUntil !== undefined && availableFrom >= availableUntil) {
    issues.add(path, "availableFrom must come before availableUntil");
  }
  if (perOrder === undefined || availableFrom === undefined || availableUntil === undefined) {
    return undefined;
  }
  return Object.freeze({ perOrder, availableFrom, availableUntil });
}

/**
 * @param {Issues} issues
 * @param {unknown} value an ISO 8601 UTC instant, e.g. "2026-10-01T00:00:00Z", or absent
 * @param {string} path
 * @returns {number | null | undefined} ms since the epoch, null when absent, undefined when invalid
 */
function parseInstant(issues, value, path) {
  if (value === undefined) {
    return null;
  }
  const text = checkString(issues, value, path, { pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/ });
  const ms = text === undefined ? Number.NaN : Date.parse(text);
  return Number.isFinite(ms) ? ms : issues.add(path, "expected an ISO 8601 UTC instant like 2026-10-01T00:00:00Z");
}

/**
 * @typedef {{ products: ReadonlyMap<string, Omit<Product, "cardsPerUnit">>, context: ProductContext, issues: Issues }} ExpansionScope
 */

/**
 * Cards one unit of `product` gives, following nested products; reports
 * unknown products, cycles, excessive nesting and oversized products.
 * @param {Omit<Product, "cardsPerUnit">} product
 * @param {readonly string[]} trail product ids being expanded
 * @param {ExpansionScope} scope
 * @returns {number | undefined}
 */
function cardsOf(product, trail, scope) {
  const { issues } = scope;
  const path = [...trail, product.id];
  if (trail.includes(product.id)) {
    return issues.add(`products.${trail[0]}`, `contains itself (${path.join(" → ")})`);
  }
  if (path.length > MAX_DEPTH) {
    return issues.add(`products.${trail[0]}`, `nested more than ${MAX_DEPTH} levels`);
  }
  let total = 0;
  for (const content of product.contents) {
    const each = cardsOfContent(content, path, scope);
    if (each === undefined) {
      return undefined;
    }
    total += each * content.count;
  }
  if (total > MAX_CARDS_PER_ORDER) {
    return issues.add(`products.${path[0]}`, `gives ${total} cards; at most ${MAX_CARDS_PER_ORDER} per order`);
  }
  return total;
}

/**
 * @param {ProductContent} content
 * @param {readonly string[]} trail
 * @param {ExpansionScope} scope
 */
function cardsOfContent(content, trail, { products, context, issues }) {
  switch (content.type) {
    case ContentType.CARD:
      return 1;
    case ContentType.PACK:
      return /** @type {{ size: number }} */ (context.dropTables.get(content.ref)).size;
    case ContentType.DECK:
      return /** @type {{ totalCards: number }} */ (context.decks.get(content.ref)).totalCards;
    case ContentType.ENTRY:
      return 0;
    default: {
      const nested = products.get(content.ref);
      return nested === undefined ? issues.add(`products.${trail[0]}`, `unknown product "${content.ref}"`) : cardsOf(nested, trail, { products, context, issues });
    }
  }
}

/**
 * What `quantity` units of a product give, flattened: nested products are
 * expanded, identical cards merged. Pure: fulfilment mints from this.
 * @param {Product} product
 * @param {number} quantity
 * @param {ReadonlyMap<string, Product>} products
 * @returns {Expansion}
 */
export function expandProduct(product, quantity, products) {
  /** @type {Map<string, { definitionId: string, count: number }>} */
  const cards = new Map();
  /** @type {string[]} */
  const packs = [];
  /** @type {string[]} */
  const decks = [];
  /** @type {Map<string, number>} */
  const entries = new Map();
  const visit = (current, times) => {
    for (const content of current.contents) {
      const count = content.count * times;
      if (content.type === ContentType.CARD) {
        const entry = cards.get(content.ref) ?? { definitionId: content.ref, count: 0 };
        entry.count += count;
        cards.set(content.ref, entry);
      } else if (content.type === ContentType.PACK) {
        packs.push(...Array.from({ length: count }, () => content.ref));
      } else if (content.type === ContentType.DECK) {
        decks.push(...Array.from({ length: count }, () => content.ref));
      } else if (content.type === ContentType.ENTRY) {
        entries.set(content.ref, (entries.get(content.ref) ?? 0) + count);
      } else {
        visit(/** @type {Product} */ (products.get(content.ref)), count);
      }
    }
  };
  visit(product, quantity);
  return Object.freeze({
    cards: Object.freeze([...cards.values()].map((entry) => Object.freeze(entry))),
    packs: Object.freeze(packs),
    decks: Object.freeze(decks),
    entries: Object.freeze([...entries].map(([kind, count]) => Object.freeze({ kind, count }))),
  });
}
