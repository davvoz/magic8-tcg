/**
 * Produces the match seed: a 32-byte key from the platform CSPRNG, as 64
 * lowercase hex characters. The key is then the only source of randomness for
 * the whole match (see @magic8/engine domain/random/ChaChaRandom.js).
 */

const SEED_BYTES = 32;

/** @returns {string} 64 lowercase hex characters */
export function createSeed() {
  const bytes = new Uint8Array(SEED_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
