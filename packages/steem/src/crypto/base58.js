/**
 * Base58 (Bitcoin alphabet), used by STEEM for public keys (STM…) and WIF
 * private keys. Straight big-number conversion; inputs are short (≤ 64 bytes).
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE = 58n;
const INDEX = new Map([...ALPHABET].map((character, index) => [character, BigInt(index)]));
const MAX_ENCODED_LENGTH = 128;

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function base58Encode(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("base58Encode: expected a Uint8Array");
  }
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  let encoded = "";
  while (value > 0n) {
    encoded = ALPHABET[Number(value % BASE)] + encoded;
    value /= BASE;
  }
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) {
    leadingZeros += 1;
  }
  return "1".repeat(leadingZeros) + encoded;
}

/**
 * @param {string} text
 * @returns {Uint8Array | null} null when `text` is not valid base58
 */
export function base58Decode(text) {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_ENCODED_LENGTH) {
    return null;
  }
  let value = 0n;
  for (const character of text) {
    const digit = INDEX.get(character);
    if (digit === undefined) {
      return null;
    }
    value = value * BASE + digit;
  }
  const bytes = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  let leadingOnes = 0;
  while (leadingOnes < text.length && text[leadingOnes] === "1") {
    leadingOnes += 1;
  }
  return Uint8Array.from([...new Array(leadingOnes).fill(0), ...bytes]);
}
