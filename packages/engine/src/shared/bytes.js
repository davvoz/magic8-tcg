/**
 * Strict hex ⇄ bytes conversion. Only lowercase hex is accepted, so a value
 * has exactly one textual form (important wherever text is hashed).
 */

const HEX_PATTERN = /^(?:[0-9a-f]{2})*$/;

/**
 * @param {string} hex lowercase, even length
 * @returns {Uint8Array}
 */
export function hexToBytes(hex) {
  if (typeof hex !== "string" || !HEX_PATTERN.test(hex)) {
    throw new TypeError("hexToBytes: expected lowercase hex of even length");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/**
 * @param {Uint8Array} bytes
 * @returns {string} lowercase hex
 */
export function bytesToHex(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("bytesToHex: expected a Uint8Array");
  }
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * @param {unknown} value
 * @param {number} byteLength
 * @returns {value is string}
 */
export function isHexOfLength(value, byteLength) {
  return typeof value === "string" && value.length === byteLength * 2 && HEX_PATTERN.test(value);
}
