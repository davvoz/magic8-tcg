/**
 * Content identity (docs/tcg/03-game-blockchain-protocol.md §11).
 *
 * The content a game runs on (card sets, preconstructed decks, game and deck
 * rules) is published as one canonical JSON payload; its identity is
 *   content = H("content", utf8(payload))
 * GAME_CREATED carries that hash. Anyone holding the payload can check it
 * and rebuild exactly the rules and cards the game was played with.
 */
import { CanonicalJsonError, canonicalize, parseCanonical } from "../canonical/CanonicalJson.js";
import { HashTag, taggedHashHex, utf8 } from "../crypto/hash.js";

/** Content payloads are small (tens of KB); the bound keeps a hostile download from exhausting memory. */
export const MAX_CONTENT_BYTES = 4 * 1024 * 1024;

/**
 * @param {Readonly<{ cardSets: unknown, preconDecks: unknown, gameRules: unknown, deckRules: unknown }>} raw
 * @returns {Readonly<{ hash: string, payload: string }>}
 */
export function sealContent(raw) {
  const payload = canonicalize({ cardSets: raw.cardSets, deckRules: raw.deckRules, gameRules: raw.gameRules, preconDecks: raw.preconDecks });
  return Object.freeze({ hash: contentHashOf(payload), payload });
}

/**
 * @param {string} payload canonical JSON
 * @returns {string}
 */
export function contentHashOf(payload) {
  return taggedHashHex(HashTag.CONTENT, utf8(payload));
}

/**
 * Opens a payload obtained from anywhere (a server, a post, a file): it must
 * be canonical JSON and hash to `expectedHash`.
 * @param {string} payload
 * @param {string} expectedHash
 * @returns {Readonly<{ cardSets: unknown, preconDecks: unknown, gameRules: unknown, deckRules: unknown }> | null}
 *   null when it does not hash to `expectedHash`, is not canonical or is not a content object
 */
export function openContent(payload, expectedHash) {
  if (typeof payload !== "string" || contentHashOf(payload) !== expectedHash) {
    return null;
  }
  let raw;
  try {
    raw = parseCanonical(payload, { maxBytes: MAX_CONTENT_BYTES });
  } catch (error) {
    if (error instanceof CanonicalJsonError) {
      return null;
    }
    throw error;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const { cardSets, preconDecks, gameRules, deckRules } = /** @type {Record<string, unknown>} */ (raw);
  return Object.freeze({ cardSets, preconDecks, gameRules, deckRules });
}
