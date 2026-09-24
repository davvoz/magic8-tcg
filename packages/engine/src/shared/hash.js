/**
 * Deterministic, dependency-free string hashing (FNV-1a, 32-bit). Used
 * wherever something must vary per identifier but stay identical between
 * runs, such as the procedural art of a card. Not for security.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * @param {string} text
 * @returns {number} unsigned 32-bit hash
 */
export function hashString(text) {
  let hash = FNV_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/**
 * A small deterministic sequence of values in [0, 1) derived from a seed,
 * for procedural variation (positions, angles, counts).
 * @param {number} seed
 * @param {number} count
 * @returns {readonly number[]}
 */
export function unitSequence(seed, count) {
  const values = [];
  let state = seed >>> 0;
  for (let index = 0; index < count; index += 1) {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    state = (state ^ (state >>> 13)) >>> 0;
    values.push(state / 0x100000000);
  }
  return Object.freeze(values);
}
