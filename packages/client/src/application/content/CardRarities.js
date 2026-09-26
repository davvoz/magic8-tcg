/**
 * How rare each card is (data/economy/rarities.json, the file the server
 * prices singles and fills packs from). Rarity is not a game rule, so it
 * lives beside GameContent rather than in it; the screens show it wherever
 * a card is shown. A missing or malformed file leaves every rarity unknown
 * instead of stopping the game.
 */

/**
 * @typedef {Readonly<{ order: readonly string[], of: (cardId: string) => string | null }>} CardRarities
 */

/** @type {CardRarities} */
export const NO_RARITIES = Object.freeze({ order: Object.freeze([]), of: () => null });

const NAME = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * @param {unknown} raw the parsed rarities file
 * @param {{ has: (cardId: string) => boolean }} catalog cards the game knows
 * @returns {{ ok: true, value: CardRarities } | { ok: false, message: string }}
 */
export function buildCardRarities(raw, catalog) {
  const file = /** @type {any} */ (raw);
  const order = file?.rarities;
  if (!isRarityList(order)) {
    return { ok: false, message: "rarities: a list of distinct lowercase names" };
  }
  const cards = file?.cards;
  if (cards === null || typeof cards !== "object" || Array.isArray(cards)) {
    return { ok: false, message: "cards: an object from card id to rarity" };
  }
  const byCard = new Map();
  for (const [cardId, rarity] of Object.entries(cards)) {
    if (!order.includes(rarity)) {
      return { ok: false, message: `cards.${cardId}: unknown rarity "${String(rarity)}"` };
    }
    if (catalog.has(cardId)) {
      byCard.set(cardId, rarity);
    }
  }
  return { ok: true, value: Object.freeze({ order: Object.freeze([...order]), of: (cardId) => byCard.get(cardId) ?? null }) };
}

/**
 * @param {unknown} order
 * @returns {order is string[]}
 */
function isRarityList(order) {
  return Array.isArray(order) && order.length > 0 && order.every((name) => typeof name === "string" && NAME.test(name)) && new Set(order).size === order.length;
}
