/**
 * Structural validation of an untrusted deck list (bundled file or persisted
 * storage) into a DeckList. Does not require a catalog: unknown card ids are a
 * rule-level problem reported by DeckValidator, so a deck saved before a
 * content change can still be loaded and shown as invalid.
 */
import { LIMITS, stripControlCharacters } from "../../shared/limits.js";
import {
  Issues,
  checkArrayOf,
  checkBoolean,
  checkInteger,
  checkObject,
  checkString,
  checkUnique,
} from "../../shared/validation.js";
import { DeckList } from "./DeckList.js";

export const DECK_LIST_SCHEMA_VERSION = 1;

const DECK_KEYS = Object.freeze(["schemaVersion", "id", "name", "faction", "preconstructed", "cards"]);
const ENTRY_KEYS = Object.freeze(["cardId", "count"]);

/**
 * @param {unknown} raw
 * @param {{ requireSchemaVersion?: boolean }} [options] Files carry a schemaVersion; lists embedded in a storage envelope do not.
 * @returns {import("../../shared/Result.js").Ok<DeckList> | import("../../shared/Result.js").Fail}
 */
export function validateDeckList(raw, options = {}) {
  const issues = new Issues();
  const deck = checkDeckList(issues, raw, "deck", options.requireSchemaVersion ?? true);
  return issues.toResult(deck);
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @param {boolean} requireSchemaVersion
 * @returns {DeckList | undefined}
 */
export function checkDeckList(issues, raw, path, requireSchemaVersion) {
  const object = checkObject(issues, raw, path, DECK_KEYS);
  if (object === undefined) {
    return undefined;
  }
  if (requireSchemaVersion) {
    checkInteger(issues, object.schemaVersion, `${path}.schemaVersion`, { min: DECK_LIST_SCHEMA_VERSION, max: DECK_LIST_SCHEMA_VERSION });
  }
  const id = checkString(issues, object.id, `${path}.id`, { minLength: 1, maxLength: LIMITS.ID_MAX_LENGTH, pattern: LIMITS.ID_PATTERN });
  const name = checkString(issues, object.name, `${path}.name`, { minLength: 1, maxLength: LIMITS.NAME_MAX_LENGTH });
  const faction = checkString(issues, object.faction, `${path}.faction`, { minLength: 1, maxLength: LIMITS.ID_MAX_LENGTH, pattern: LIMITS.ID_PATTERN });
  const preconstructed = checkBoolean(issues, object.preconstructed ?? false, `${path}.preconstructed`);
  const entries = checkEntries(issues, object.cards, `${path}.cards`);

  if (!issues.isEmpty || entries === undefined) {
    return undefined;
  }
  return new DeckList({ id, name: stripControlCharacters(name), faction, preconstructed, entries });
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @returns {{ cardId: string, count: number }[] | undefined}
 */
function checkEntries(issues, raw, path) {
  const entries = checkArrayOf(issues, raw, path, {
    maxLength: LIMITS.MAX_DECK_ENTRIES,
    item: (item, itemPath) => checkEntry(issues, item, itemPath),
  });
  if (entries === undefined || !checkUnique(issues, entries, path, (entry) => entry.cardId)) {
    return undefined;
  }
  return entries;
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {string} path
 * @returns {{ cardId: string, count: number } | undefined}
 */
function checkEntry(issues, raw, path) {
  const object = checkObject(issues, raw, path, ENTRY_KEYS);
  if (object === undefined) {
    return undefined;
  }
  const cardId = checkString(issues, object.cardId, `${path}.cardId`, { minLength: 1, maxLength: LIMITS.ID_MAX_LENGTH, pattern: LIMITS.ID_PATTERN });
  const count = checkInteger(issues, object.count, `${path}.count`, { min: 1, max: LIMITS.MAX_COPIES_PER_ENTRY });
  return cardId === undefined || count === undefined ? undefined : { cardId, count };
}
