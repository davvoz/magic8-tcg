/**
 * Randomness port: every secret, token, nonce and id is drawn from an
 * injected CSPRNG so tests can make it deterministic.
 *
 * @typedef {{ bytes: (length: number) => Uint8Array }} SecureRandom
 */
import { randomBytes } from "node:crypto";

const MAX_BYTES = 1024;

/** @type {SecureRandom} */
export const nodeSecureRandom = Object.freeze({
  bytes(length) {
    if (!Number.isInteger(length) || length <= 0 || length > MAX_BYTES) {
      throw new RangeError("SecureRandom.bytes: length must be in 1..1024");
    }
    return new Uint8Array(randomBytes(length));
  },
});

/**
 * @param {Uint8Array} bytes
 * @returns {string} base64url without padding
 */
export function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * RFC 4122 version 4 UUID.
 * @param {SecureRandom} random
 */
export function uuidV4(random) {
  const bytes = random.bytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
