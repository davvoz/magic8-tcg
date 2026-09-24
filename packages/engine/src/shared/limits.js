/**
 * Hard structural limits applied by validators regardless of game rules.
 * Game rules (deck size, copies, …) are data; these bounds protect the engine
 * from unbounded or malformed input and are intentionally not configurable.
 */
export const LIMITS = Object.freeze({
  ID_PATTERN: /^[a-z0-9_]+$/,
  ID_MAX_LENGTH: 40,
  INSTANCE_ID_MAX_LENGTH: 32,
  NAME_MAX_LENGTH: 40,
  TEXT_MAX_LENGTH: 200,
  MAX_COST: 20,
  MAX_ATTACK: 99,
  MAX_HEALTH: 99,
  MAX_ABILITIES_PER_CARD: 4,
  MAX_KEYWORDS_PER_CARD: 4,
  MAX_CARDS_PER_SET: 1000,
  MAX_DECK_ENTRIES: 200,
  MAX_COPIES_PER_ENTRY: 99,
  MAX_FACTIONS: 16,
  MAX_TARGET_COUNT: 3,
  MAX_FREEZE_DEPTH: 64,
});

/** Strips ASCII control characters; used on every free-text field before it reaches rendering. */
export function stripControlCharacters(text) {
  // eslint-disable-next-line no-control-regex -- intentionally matching control characters
  return text.replace(/[\u0000-\u001F\u007F]/g, "");
}
