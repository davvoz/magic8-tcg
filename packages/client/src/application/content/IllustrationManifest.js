/**
 * Which cards have a painted illustration (data/art/illustrations.json).
 * Art is not a game rule, so like rarity it lives beside GameContent rather
 * than in it. A card missing from the file keeps its procedural art; a
 * missing or malformed file leaves every card procedural instead of
 * stopping the game.
 *
 * File names are bare names (no directories) with an image extension, so
 * the manifest can only point inside the art directory.
 */

/**
 * @typedef {readonly [number, number]} Focus the point of the image (0..1 on each axis) kept in view when it is cropped
 * @typedef {Readonly<{ file: string, focus: Focus }>} IllustrationEntry
 * @typedef {Readonly<{ entries: ReadonlyMap<string, IllustrationEntry>, unknownCards: readonly string[] }>} IllustrationManifest
 *   `unknownCards`: ids in the file the catalog does not know (typos, retired cards), left out of `entries`
 */

const SCHEMA_VERSION = 1;
const FILE_NAME = /^[a-z0-9][a-z0-9_-]{0,95}\.(webp|png|jpg|jpeg)$/;
/** @type {Focus} */
const CENTER = Object.freeze([0.5, 0.5]);

/** @type {IllustrationManifest} */
export const NO_ILLUSTRATIONS = Object.freeze({ entries: new Map(), unknownCards: Object.freeze([]) });

/**
 * @param {unknown} raw the parsed illustrations file
 * @param {{ has: (cardId: string) => boolean }} catalog cards the game knows
 * @returns {{ ok: true, value: IllustrationManifest } | { ok: false, message: string }}
 */
export function buildIllustrationManifest(raw, catalog) {
  const file = /** @type {any} */ (raw);
  if (file?.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, message: `schemaVersion: expected ${SCHEMA_VERSION}` };
  }
  const cards = file.cards;
  if (cards === null || typeof cards !== "object" || Array.isArray(cards)) {
    return { ok: false, message: "cards: an object from card id to { file, focus? }" };
  }
  /** @type {Map<string, IllustrationEntry>} */
  const entries = new Map();
  const unknownCards = [];
  for (const [cardId, value] of Object.entries(cards)) {
    const entry = parseEntry(value);
    if (typeof entry === "string") {
      return { ok: false, message: `cards.${cardId}: ${entry}` };
    }
    if (catalog.has(cardId)) {
      entries.set(cardId, entry);
    } else {
      unknownCards.push(cardId);
    }
  }
  return { ok: true, value: Object.freeze({ entries, unknownCards: Object.freeze(unknownCards) }) };
}

/**
 * @param {unknown} value
 * @returns {IllustrationEntry | string} the entry, or what is wrong with it
 */
function parseEntry(value) {
  const entry = /** @type {any} */ (value);
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return "an object { file, focus? }";
  }
  if (typeof entry.file !== "string" || !FILE_NAME.test(entry.file)) {
    return "file: a lowercase file name ending in .webp, .png, .jpg or .jpeg, without directories";
  }
  if (entry.focus === undefined) {
    return Object.freeze({ file: entry.file, focus: CENTER });
  }
  if (!isFocus(entry.focus)) {
    return "focus: [x, y], each between 0 and 1";
  }
  /** @type {Focus} */
  const focus = Object.freeze([entry.focus[0], entry.focus[1]]);
  return Object.freeze({ file: entry.file, focus });
}

/**
 * @param {unknown} focus
 * @returns {focus is [number, number]}
 */
function isFocus(focus) {
  return Array.isArray(focus) && focus.length === 2 && focus.every((value) => typeof value === "number" && value >= 0 && value <= 1);
}
