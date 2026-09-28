/**
 * A small integer seed from a text (32-bit FNV-1a), for cosmetic choices
 * that every client must draw alike without talking to each other — such as
 * which player an online game's coin toss shows holding heads. Anyone who
 * knows the text knows the outcome, so it must never decide anything that
 * matters to the game.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * @param {string} text
 * @returns {number} an unsigned 32-bit integer, a valid engine seed
 */
export function textSeed(text) {
  let hash = FNV_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}
