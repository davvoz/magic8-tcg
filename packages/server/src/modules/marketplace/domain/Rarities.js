/**
 * Card rarities: collection data, not game rules (the engine never reads
 * them), so they live in data/economy/rarities.json and do not change the
 * content hash games commit to. Every card of the catalog must have one, so
 * a new card cannot silently stay out of every pack.
 *
 * @typedef {Readonly<{ order: readonly string[], of: ReadonlyMap<string, string> }>} Rarities
 */
import { Issues, checkArray, checkInteger, checkObject, checkString } from "@magic8/engine/shared/validation.js";

const FILE_KEYS = Object.freeze(["schemaVersion", "rarities", "cards"]);
const RARITY_PATTERN = /^[a-z][a-z0-9_]{0,23}$/;

/**
 * @param {unknown} raw
 * @param {{ has: (id: string) => boolean, all: () => readonly { id: string }[] }} catalog
 * @returns {import("@magic8/engine/shared/Result.js").Ok<Rarities> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function validateRarities(raw, catalog) {
  const issues = new Issues();
  const file = checkObject(issues, raw, "rarities", FILE_KEYS);
  if (file === undefined) {
    return issues.toResult(undefined);
  }
  checkInteger(issues, file.schemaVersion, "rarities.schemaVersion", { min: 1, max: 1 });
  const order = (checkArray(issues, file.rarities, "rarities.rarities", { minLength: 1, maxLength: 12 }) ?? []).filter((rarity, index) => checkString(issues, rarity, `rarities.rarities[${index}]`, { pattern: RARITY_PATTERN }) !== undefined);
  if (new Set(order).size !== order.length) {
    issues.add("rarities.rarities", "duplicate rarity");
  }
  const cards = checkObject(issues, file.cards, "rarities.cards") ?? {};
  /** @type {Map<string, string>} */
  const of = new Map();
  for (const [cardId, rarity] of Object.entries(cards)) {
    if (!catalog.has(cardId)) {
      issues.add(`rarities.cards.${cardId}`, "not a card of the current content");
    } else if (typeof rarity !== "string" || !order.includes(rarity)) {
      issues.add(`rarities.cards.${cardId}`, `expected one of ${order.join(", ")}`);
    } else {
      of.set(cardId, rarity);
    }
  }
  for (const card of catalog.all()) {
    if (!(card.id in cards)) {
      issues.add(`rarities.cards.${card.id}`, "missing: every card needs a rarity");
    }
  }
  return issues.toResult(Object.freeze({ order: Object.freeze([...order]), of }));
}
