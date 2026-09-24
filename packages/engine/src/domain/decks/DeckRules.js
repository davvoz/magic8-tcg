/**
 * Deck-building rules, loaded from configuration and validated. Consumed by
 * DeckValidator (rule checks) and by card content validation (faction list).
 */
import { LIMITS } from "../../shared/limits.js";
import {
  Issues,
  checkArrayOf,
  checkEnum,
  checkInteger,
  checkObject,
  checkString,
  checkUnique,
} from "../../shared/validation.js";
import { CARD_TYPES } from "../cards/CardType.js";

export const DECK_RULES_SCHEMA_VERSION = 1;

export const FactionRuleMode = Object.freeze({
  /** Cards must belong to the deck's faction or to the configured neutral faction. */
  SINGLE_PLUS_NEUTRAL: "single_plus_neutral",
  /** No faction restriction: the deck's faction is its theme, every card may go in. */
  ANY: "any",
});

const FACTION_RULE_MODES = Object.freeze(Object.values(FactionRuleMode));
const MAX_DECK_CARDS = LIMITS.MAX_DECK_ENTRIES * LIMITS.MAX_COPIES_PER_ENTRY;
const MAX_SAVED_DECKS_LIMIT = 500;
const RULES_KEYS = Object.freeze([
  "schemaVersion",
  "minSize",
  "maxSize",
  "maxCopies",
  "allowedTypes",
  "factions",
  "factionRule",
  "maxSavedDecks",
  "deckNameMaxLength",
]);
const FACTION_RULE_KEYS = Object.freeze(["mode", "neutral"]);

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
  /** @type {Readonly<{ mode: string, neutral: string | null }>} */
  factionRule;
  /** @type {number} */
  maxSavedDecks;
  /** @type {number} */
  deckNameMaxLength;

  /**
   * @param {{ minSize: number, maxSize: number, maxCopies: number, allowedTypes: readonly string[], factions: readonly string[], factionRule: { mode: string, neutral: string | null }, maxSavedDecks: number, deckNameMaxLength: number }} fields
   */
  constructor({ minSize, maxSize, maxCopies, allowedTypes, factions, factionRule, maxSavedDecks, deckNameMaxLength }) {
    this.minSize = minSize;
    this.maxSize = maxSize;
    this.maxCopies = maxCopies;
    this.allowedTypes = Object.freeze([...allowedTypes]);
    this.factions = Object.freeze([...factions]);
    this.factionRule = Object.freeze({ mode: factionRule.mode, neutral: factionRule.neutral });
    this.maxSavedDecks = maxSavedDecks;
    this.deckNameMaxLength = deckNameMaxLength;
    Object.freeze(this);
  }

  /** @param {string} faction */
  isKnownFaction(faction) {
    return this.factions.includes(faction);
  }

  /**
   * Factions a deck can be built around: every faction except the shared
   * (neutral) pool when one is named. Under single_plus_neutral a deck made
   * only of neutral cards would have too few cards to reach the minimum
   * size; under any the pool is simply not a theme to start a deck from.
   * @returns {readonly string[]}
   */
  get deckFactions() {
    if (this.factionRule.neutral === null) {
      return this.factions;
    }
    return Object.freeze(this.factions.filter((faction) => faction !== this.factionRule.neutral));
  }

  /** @param {string} faction */
  isDeckFaction(faction) {
    return this.deckFactions.includes(faction);
  }

  /** Whether a deck's faction limits which cards it may hold (false: the faction is only its theme). */
  get restrictsCards() {
    return this.factionRule.mode !== FactionRuleMode.ANY;
  }

  /**
   * Whether a card of `cardFaction` may go into a deck of `deckFaction`.
   * @param {string} deckFaction
   * @param {string} cardFaction
   */
  allowsFaction(deckFaction, cardFaction) {
    if (this.factionRule.mode === FactionRuleMode.ANY) {
      return true;
    }
    return cardFaction === deckFaction || cardFaction === this.factionRule.neutral;
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
  const factionRule = checkFactionRule(issues, object.factionRule, "deckRules.factionRule", factions ?? []);
  const maxSavedDecks = checkInteger(issues, object.maxSavedDecks, "deckRules.maxSavedDecks", { min: 1, max: MAX_SAVED_DECKS_LIMIT });
  const deckNameMaxLength = checkInteger(issues, object.deckNameMaxLength, "deckRules.deckNameMaxLength", { min: 1, max: LIMITS.NAME_MAX_LENGTH });

  if (!issues.isEmpty) {
    return issues.toResult(undefined);
  }
  return issues.toResult(
    new DeckRules({ minSize, maxSize, maxCopies, allowedTypes, factions, factionRule, maxSavedDecks, deckNameMaxLength }),
  );
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

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @param {readonly string[]} factions
 * @returns {{ mode: string, neutral: string | null } | undefined}
 */
function checkFactionRule(issues, raw, path, factions) {
  const object = checkObject(issues, raw, path, FACTION_RULE_KEYS);
  if (object === undefined) {
    return undefined;
  }
  const mode = checkEnum(issues, object.mode, `${path}.mode`, FACTION_RULE_MODES);
  // Under `any` the shared pool is optional: naming it only keeps it out of the factions a deck starts from.
  if (mode === FactionRuleMode.ANY && (object.neutral === undefined || object.neutral === null)) {
    return { mode, neutral: null };
  }
  const neutral = checkEnum(issues, object.neutral, `${path}.neutral`, factions);
  return mode === undefined || neutral === undefined ? undefined : { mode, neutral };
}
