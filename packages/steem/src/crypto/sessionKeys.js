/**
 * Session keys of signed moves (game protocol v2, docs/tcg/12-mosse-firmate.md):
 * P-256 ECDSA with SHA-256, as a browser's WebCrypto makes them with a key
 * that cannot be exported. Not a STEEM key: STEEM only authorises it, with
 * the account's posting key (see recoverSigner).
 */
import { p256 } from "@noble/curves/nist.js";

const PUBLIC_KEY = /^04[0-9a-f]{128}$/;
const SIGNATURE = /^[0-9a-f]{128}$/;
const encoder = new TextEncoder();

/** @param {string} hex */
const bytesOf = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

/**
 * Whether `signatureHex` (r ‖ s) is the session key's signature of `message`.
 * WebCrypto does not normalise s, so both halves of the curve are accepted:
 * that changes nothing here, the signed text is fixed by the protocol.
 * @param {string} message
 * @param {string} signatureHex 128 hex characters
 * @param {string} publicKeyHex uncompressed point, 130 hex characters
 * @returns {boolean}
 */
export function verifySessionSignature(message, signatureHex, publicKeyHex) {
  if (typeof message !== "string" || typeof signatureHex !== "string" || typeof publicKeyHex !== "string" || !SIGNATURE.test(signatureHex) || !PUBLIC_KEY.test(publicKeyHex)) {
    return false;
  }
  try {
    return p256.verify(bytesOf(signatureHex), encoder.encode(message), bytesOf(publicKeyHex), { lowS: false });
  } catch {
    return false;
  }
}
