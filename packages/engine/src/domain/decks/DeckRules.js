/**
 * Deck-building rules, loaded from configuration and validated. Consumed by
 * DeckValidator (rule checks) and by card content validation (faction list).
 * A deck has no faction: any card may go in any deck. The faction list is
 * what cards may belong to, in the order a deck's mix is shown.
 */
import { LIMITS } from "../../shared/limits.js";
import {
  Issues,
  allDefined,
  checkArrayOf,
  checkEnum,
  checkInteger,
  checkObject,
  checkString,
  checkUnique,
} from "../../shared/validation.js";
import { CARD_TYPES } from "../cards/CardType.js";

export const DECK_RULES_SCHEMA_VERSION = 1;

const MAX_DECK_CARDS = LIMITS.MAX_DECK_ENTRIES * LIMITS.MAX_COPIES_PER_ENTRY;
const MAX_SAVED_DECKS_LIMIT = 500;
const RULES_KEYS = Object.freeze([
  "schemaVersion",
  "minSize",
  "maxSize",
  "maxCopies",
  "allowedTypes",
  "factions",
  // Decks no longer have a faction (2026-10-01): any card may go in any deck.
  // Content published before then still carries the rule; it is read and ignored.
  "factionRule",
  "maxSavedDecks",
  "deckNameMaxLength",
]);

export class DeckRules {
  /** @type {number} */
  minSize;
  /** @type {number} */
  maxSize;
  /** @type {number} */
  maxCopies;
  /** @type {readonly string[]} */
  allowedTypes;
  /** @type {readonly string[]} */
  factions;
  /** @type {number} */
  maxSavedDecks;
  /** @type {number} */
  deckNameMaxLength;

  /**
   * @param {{ minSize: number, maxSize: number, maxCopies: number, allowedTypes: readonly string[], factions: readonly string[], maxSavedDecks: number, deckNameMaxLength: number }} fields
   */
  constructor({ minSize, maxSize, maxCopies, allowedTypes, factions, maxSavedDecks, deckNameMaxLength }) {
    this.minSize = minSize;
    this.maxSize = maxSize;
    this.maxCopies = maxCopies;
    this.allowedTypes = Object.freeze([...allowedTypes]);
    this.factions = Object.freeze([...factions]);
    this.maxSavedDecks = maxSavedDecks;
    this.deckNameMaxLength = deckNameMaxLength;
    Object.freeze(this);
  }
}

/**
 * @param {unknown} raw
 * @returns {import("../../shared/Result.js").Ok<DeckRules> | import("../../shared/Result.js").Fail}
 */
export function validateDeckRules(raw) {
  const issues = new Issues();
  const object = checkObject(issues, raw, "deckRules", RULES_KEYS);
  if (object === undefined) {
    return issues.toResult(undefined);
  }
  checkInteger(issues, object.schemaVersion, "deckRules.schemaVersion", { min: DECK_RULES_SCHEMA_VERSION, max: DECK_RULES_SCHEMA_VERSION });
  const minSize = checkInteger(issues, object.minSize, "deckRules.minSize", { min: 1, max: MAX_DECK_CARDS });
  const maxSize = checkInteger(issues, object.maxSize, "deckRules.maxSize", { min: minSize ?? 1, max: MAX_DECK_CARDS });
  const maxCopies = checkInteger(issues, object.maxCopies, "deckRules.maxCopies", { min: 1, max: LIMITS.MAX_COPIES_PER_ENTRY });
  const allowedTypes = checkArrayOf(issues, object.allowedTypes, "deckRules.allowedTypes", {
    minLength: 1,
    maxLength: CARD_TYPES.length,
    item: (item, path) => checkEnum(issues, item, path, CARD_TYPES),
  });
  const factions = checkFactions(issues, object.factions, "deckRules.factions");
  const maxSavedDecks = checkInteger(issues, object.maxSavedDecks, "deckRules.maxSavedDecks", { min: 1, max: MAX_SAVED_DECKS_LIMIT });
  const deckNameMaxLength = checkInteger(issues, object.deckNameMaxLength, "deckRules.deckNameMaxLength", { min: 1, max: LIMITS.NAME_MAX_LENGTH });

  const fields = allDefined({ minSize, maxSize, maxCopies, allowedTypes, factions, maxSavedDecks, deckNameMaxLength });
  if (!issues.isEmpty || fields === undefined) {
    return issues.toResult(undefined);
  }
  return issues.toResult(new DeckRules(fields));
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @returns {string[] | undefined}
 */
function checkFactions(issues, raw, path) {
  const factions = checkArrayOf(issues, raw, path, {
    minLength: 1,
    maxLength: LIMITS.MAX_FACTIONS,
    item: (item, itemPath) => checkString(issues, item, itemPath, { minLength: 1, maxLength: LIMITS.ID_MAX_LENGTH, pattern: LIMITS.ID_PATTERN }),
  });
  if (factions === undefined || !checkUnique(issues, factions, path, (faction) => faction)) {
    return undefined;
  }
  return factions;
}
