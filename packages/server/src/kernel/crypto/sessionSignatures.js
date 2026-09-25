/**
 * Verification of signed moves (game protocol v2, docs/tcg/12) with Node's
 * native P-256: the same check as @magic8/steem's verifySessionSignature
 * (which browsers and verifiers use), about thirty times faster, which
 * matters on the path of every command. Session keys are parsed once and
 * kept in a small cache.
 */
import { createPublicKey, verify } from "node:crypto";

const PUBLIC_KEY = /^04[0-9a-f]{128}$/;
const SIGNATURE = /^[0-9a-f]{128}$/;
const CACHE_SIZE = 2048;

/** @type {Map<string, import("node:crypto").KeyObject | null>} key hex → parsed key (null: not a point on the curve) */
const keys = new Map();

/** @param {string} hex */
function keyObject(hex) {
  if (keys.has(hex)) {
    return keys.get(hex) ?? null;
  }
  const point = Buffer.from(hex, "hex");
  let parsed = null;
  try {
    parsed = createPublicKey({ key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") }, format: "jwk" });
  } catch {
    parsed = null;
  }
  keys.set(hex, parsed);
  if (keys.size > CACHE_SIZE) {
    keys.delete(/** @type {string} */ (keys.keys().next().value));
  }
  return parsed;
}

/**
 * @param {string} message
 * @param {string} signatureHex r ‖ s, 128 hex characters
 * @param {string} publicKeyHex uncompressed P-256 point, 130 hex characters
 * @returns {boolean}
 */
export function verifySessionSignature(message, signatureHex, publicKeyHex) {
  if (typeof message !== "string" || typeof signatureHex !== "string" || typeof publicKeyHex !== "string" || !SIGNATURE.test(signatureHex) || !PUBLIC_KEY.test(publicKeyHex)) {
    return false;
  }
  const key = keyObject(publicKeyHex);
  if (key === null) {
    return false;
  }
  try {
    return verify("sha256", Buffer.from(message, "utf8"), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}
