/**
 * Hashing primitives of the protocol (docs/tcg/03-game-blockchain-protocol.md §4).
 *
 * Every protocol hash is domain-separated:
 *   H(tag, bytes) = SHA-256( utf8("m8tcg/v1/" + tag) ‖ 0x00 ‖ bytes )
 * so a hash computed for one purpose can never be presented as another.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, isHexOfLength } from "@magic8/engine/shared/bytes.js";

const DOMAIN_PREFIX = "m8tcg/v1/";
const SEPARATOR = new Uint8Array([0]);
const TAG_PATTERN = /^[a-z][a-z-]{0,31}$/;
const encoder = new TextEncoder();

export const HASH_BYTES = 32;

/** Tags defined by protocol v1. */
export const HashTag = Object.freeze({
  GENESIS: "genesis",
  EVENT: "event",
  SEED_COMMIT: "seed-commit",
  SEED: "seed",
  STATE_SALT: "state-salt",
  STATE: "state",
  CONTENT: "content",
  DECK_SALT: "deck-salt",
  DECK: "deck",
  DROP_TABLE: "drop-table",
  PACK_EPOCH: "pack-epoch",
});

/**
 * @param {string} text
 * @returns {Uint8Array}
 */
export function utf8(text) {
  return encoder.encode(text);
}

/**
 * @param {...Uint8Array} parts
 * @returns {Uint8Array}
 */
export function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/**
 * @param {string} tag one of HashTag
 * @param {...Uint8Array} parts concatenated in order
 * @returns {Uint8Array} 32 bytes
 */
export function taggedHash(tag, ...parts) {
  if (!TAG_PATTERN.test(tag)) {
    throw new TypeError(`taggedHash: invalid tag "${tag}"`);
  }
  for (const part of parts) {
    if (!(part instanceof Uint8Array)) {
      throw new TypeError("taggedHash: parts must be Uint8Array");
    }
  }
  return sha256(concatBytes(utf8(DOMAIN_PREFIX + tag), SEPARATOR, ...parts));
}

/**
 * @param {string} tag
 * @param {...Uint8Array} parts
 * @returns {string} 64 lowercase hex characters
 */
export function taggedHashHex(tag, ...parts) {
  return bytesToHex(taggedHash(tag, ...parts));
}

/**
 * Plain SHA-256, for values defined outside the protocol (e.g. session token hashes).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function sha256Hex(bytes) {
  return bytesToHex(sha256(bytes));
}

/**
 * @param {unknown} value
 * @returns {value is string} true for a 32-byte hash as lowercase hex
 */
export function isHash(value) {
  return isHexOfLength(value, HASH_BYTES);
}

export { bytesToHex, hexToBytes, isHexOfLength };
