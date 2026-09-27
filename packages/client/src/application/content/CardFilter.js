/**
 * The card filter every screen that lists cards offers, the same
 * everywhere: by faction, by rarity and by type (creature or spell), each
 * "all" or one value. The options come from the content (the deck rules'
 * factions, the rarities file, the engine's card types), so a new faction
 * or rarity shows up on every screen at once.
 */
import { CARD_TYPES } from "@magic8/engine/domain/cards/CardType.js";

/** The option that lets everything through. */
export const ANY = "all";

/** @typedef {"faction" | "rarity" | "type"} CardFilterField */
/** @typedef {Readonly<{ faction: string, rarity: string, type: string }>} CardFilter */
/** @typedef {Readonly<{ faction: readonly string[], rarity: readonly string[], type: readonly string[] }>} CardFilterOptions */

/** Nothing filtered. @type {CardFilter} */
export const NO_CARD_FILTER = Object.freeze({ faction: ANY, rarity: ANY, type: ANY });

/** @type {readonly CardFilterField[]} */
export const CARD_FILTER_FIELDS = Object.freeze(["faction", "rarity", "type"]);

/**
 * Each field's values, "all" first.
 * @param {{ content: { deckRules: { factions: readonly string[] } }, rarities?: { order: readonly string[] } }} app
 * @returns {CardFilterOptions}
 */
export function cardFilterOptions(app) {
  return Object.freeze({
    faction: Object.freeze([ANY, ...app.content.deckRules.factions]),
    rarity: Object.freeze([ANY, ...(app.rarities?.order ?? [])]),
    type: Object.freeze([ANY, ...CARD_TYPES]),
  });
}

/**
 * The filter with one field changed.
 * @param {CardFilter} filter
 * @param {CardFilterField} field
 * @param {string} value
 * @returns {CardFilter}
 */
export function withCardFilter(filter, field, value) {
  return Object.freeze({ ...filter, [field]: value });
}

/** @param {CardFilter} filter */
export function isFiltering(filter) {
  return CARD_FILTER_FIELDS.some((field) => filter[field] !== ANY);
}

/**
 * Whether a card passes. A card the game does not know passes only when
 * nothing is filtered.
 * @param {CardFilter} filter
 * @param {Readonly<{ faction: string, type: string }> | undefined} card
 * @param {string | null} rarity
 */
export function matchesCardFilter(filter, card, rarity) {
  if (card === undefined) {
    return !isFiltering(filter);
  }
  return (filter.faction === ANY || card.faction === filter.faction) && (filter.type === ANY || card.type === filter.type) && (filter.rarity === ANY || rarity === filter.rarity);
}

/**
 * The ids of the catalog's cards that pass, or null when nothing is
 * filtered (every card, known or not).
 * @param {CardFilter} filter
 * @param {{ content: { catalog: { all: () => readonly Readonly<{ id: string, faction: string, type: string }>[] } }, rarities?: { of: (cardId: string) => string | null } }} app
 * @returns {readonly string[] | null}
 */
export function cardIdsMatching(filter, app) {
  if (!isFiltering(filter)) {
    return null;
  }
  return Object.freeze(
    app.content.catalog
      .all()
      .filter((card) => matchesCardFilter(filter, card, app.rarities?.of(card.id) ?? null))
      .map((card) => card.id),
  );
}

/**
 * The filter in words, for "No … cards" messages: "rare ember creature"
 * ("" when nothing is filtered).
 * @param {CardFilter} filter
 */
export function describeCardFilter(filter) {
  return CARD_FILTER_FIELDS.map((field) => filter[field])
    .filter((value) => value !== ANY)
    .join(" ");
}
