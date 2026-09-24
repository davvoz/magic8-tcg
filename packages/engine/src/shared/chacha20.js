/**
 * ChaCha20 block function (RFC 8439 §2.3), dependency-free.
 *
 * Used by the engine's random source: a 256-bit key gives a keystream that is
 * cryptographically unpredictable without the key yet fully reproducible with
 * it, which is exactly what a verifiable replay needs. Only the block function
 * is provided; this is not an encryption API.
 */

const WORDS_PER_BLOCK = 16;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const DOUBLE_ROUNDS = 10;

/** "expand 32-byte k" as little-endian words. */
const SIGMA = Object.freeze([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);

/**
 * @param {number} value
 * @param {number} shift
 */
function rotl(value, shift) {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

/** Index quadruples of one double round: four column rounds, then four diagonal rounds. */
const DOUBLE_ROUND = Object.freeze([
  [0, 4, 8, 12],
  [1, 5, 9, 13],
  [2, 6, 10, 14],
  [3, 7, 11, 15],
  [0, 5, 10, 15],
  [1, 6, 11, 12],
  [2, 7, 8, 13],
  [3, 4, 9, 14],
].map((indices) => Object.freeze(indices)));

/**
 * The 20-round ChaCha permutation followed by the feed-forward addition.
 * @param {Uint32Array} initial
 * @returns {Uint32Array}
 */
function permute(initial) {
  const x = initial.slice();
  const quarterRound = ([a, b, c, d]) => {
    x[a] = (x[a] + x[b]) >>> 0;
    x[d] = rotl(x[d] ^ x[a], 16);
    x[c] = (x[c] + x[d]) >>> 0;
    x[b] = rotl(x[b] ^ x[c], 12);
    x[a] = (x[a] + x[b]) >>> 0;
    x[d] = rotl(x[d] ^ x[a], 8);
    x[c] = (x[c] + x[d]) >>> 0;
    x[b] = rotl(x[b] ^ x[c], 7);
  };
  for (let round = 0; round < DOUBLE_ROUNDS; round += 1) {
    DOUBLE_ROUND.forEach(quarterRound);
  }
  for (let word = 0; word < WORDS_PER_BLOCK; word += 1) {
    x[word] = (x[word] + initial[word]) >>> 0;
  }
  return x;
}

/**
 * @param {unknown} key
 * @param {unknown} counter
 * @param {unknown} nonce
 */
function assertBlockArguments(key, counter, nonce) {
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) {
    throw new TypeError("chacha20Block: key must be 32 bytes");
  }
  if (!(nonce instanceof Uint8Array) || nonce.length !== NONCE_BYTES) {
    throw new TypeError("chacha20Block: nonce must be 12 bytes");
  }
  if (!Number.isInteger(counter) || /** @type {number} */ (counter) < 0 || /** @type {number} */ (counter) > 0xffffffff) {
    throw new RangeError("chacha20Block: counter must be a 32-bit unsigned integer");
  }
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 */
function readUint32LE(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

/**
 * Computes one 64-byte keystream block as sixteen 32-bit words.
 * @param {Uint8Array} key 32 bytes
 * @param {number} counter 32-bit block counter
 * @param {Uint8Array} [nonce] 12 bytes, zero by default
 * @returns {Uint32Array} 16 words; serialise little-endian for the byte stream
 */
export function chacha20Block(key, counter, nonce = new Uint8Array(NONCE_BYTES)) {
  assertBlockArguments(key, counter, nonce);
  const initial = new Uint32Array(WORDS_PER_BLOCK);
  initial.set(SIGMA, 0);
  for (let word = 0; word < 8; word += 1) {
    initial[4 + word] = readUint32LE(key, word * 4);
  }
  initial[12] = counter;
  for (let word = 0; word < 3; word += 1) {
    initial[13 + word] = readUint32LE(nonce, word * 4);
  }
  return permute(initial);
}

/**
 * Serialises a block's words as bytes (little-endian), as RFC 8439 does.
 * @param {Uint32Array} words
 * @returns {Uint8Array}
 */
export function blockToBytes(words) {
  const bytes = new Uint8Array(words.length * 4);
  words.forEach((word, index) => {
    bytes[index * 4] = word & 0xff;
    bytes[index * 4 + 1] = (word >>> 8) & 0xff;
    bytes[index * 4 + 2] = (word >>> 16) & 0xff;
    bytes[index * 4 + 3] = (word >>> 24) & 0xff;
  });
  return bytes;
}
