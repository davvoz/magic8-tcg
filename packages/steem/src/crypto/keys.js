/**
 * STEEM key formats and signature recovery.
 *
 * - Public key: "STM" + base58( compressed secp256k1 point (33 bytes) ‖ ripemd160(point)[0..4] ).
 * - Private key (WIF): base58( 0x80 ‖ key (32 bytes) ‖ sha256(sha256(0x80 ‖ key))[0..4] ).
 * - Signature (Graphene compact, as produced by Steem Keychain's signBuffer):
 *   65 bytes = header ‖ r ‖ s, header = 27 + 4 (compressed) + recovery id;
 *   signBuffer signs sha256(message bytes).
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58Decode, base58Encode } from "./base58.js";

export const STEEM_KEY_PREFIX = "STM";

const PUBLIC_KEY_BYTES = 33;
const CHECKSUM_BYTES = 4;
const PRIVATE_KEY_BYTES = 32;
const WIF_VERSION = 0x80;
const SIGNATURE_BYTES = 65;
const COMPACT_HEADER_BASE = 27;
const COMPRESSED_FLAG = 4;

/**
 * @param {Uint8Array} left
 * @param {Uint8Array} right
 */
function equalBytes(left, right) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/**
 * @param {Uint8Array} compressedPoint 33 bytes
 * @param {string} [prefix]
 * @returns {string}
 */
export function encodePublicKey(compressedPoint, prefix = STEEM_KEY_PREFIX) {
  if (!(compressedPoint instanceof Uint8Array) || compressedPoint.length !== PUBLIC_KEY_BYTES) {
    throw new TypeError("encodePublicKey: expected a 33-byte compressed point");
  }
  const checksum = ripemd160(compressedPoint).slice(0, CHECKSUM_BYTES);
  return prefix + base58Encode(Uint8Array.from([...compressedPoint, ...checksum]));
}

/**
 * @param {string} text e.g. "STM8W6gDS6CM4V…"
 * @param {string} [prefix]
 * @returns {Uint8Array | null} the compressed point, or null when malformed, mis-checksummed or not on the curve
 */
export function decodePublicKey(text, prefix = STEEM_KEY_PREFIX) {
  if (typeof text !== "string" || !text.startsWith(prefix)) {
    return null;
  }
  const bytes = base58Decode(text.slice(prefix.length));
  if (bytes === null || bytes.length !== PUBLIC_KEY_BYTES + CHECKSUM_BYTES) {
    return null;
  }
  const point = bytes.slice(0, PUBLIC_KEY_BYTES);
  if (!equalBytes(ripemd160(point).slice(0, CHECKSUM_BYTES), bytes.slice(PUBLIC_KEY_BYTES))) {
    return null;
  }
  try {
    secp256k1.Point.fromBytes(point);
  } catch {
    return null;
  }
  return point;
}

/**
 * @param {string} wif
 * @returns {Uint8Array | null} the 32-byte private key, or null when malformed
 */
export function decodeWif(wif) {
  const bytes = base58Decode(wif);
  if (bytes === null || bytes.length !== 1 + PRIVATE_KEY_BYTES + CHECKSUM_BYTES || bytes[0] !== WIF_VERSION) {
    return null;
  }
  const payload = bytes.slice(0, 1 + PRIVATE_KEY_BYTES);
  if (!equalBytes(sha256(sha256(payload)).slice(0, CHECKSUM_BYTES), bytes.slice(1 + PRIVATE_KEY_BYTES))) {
    return null;
  }
  const key = payload.slice(1);
  return secp256k1.utils.isValidSecretKey(key) ? key : null;
}

/**
 * @param {Uint8Array} privateKey 32 bytes
 * @param {string} [prefix]
 * @returns {string}
 */
export function publicKeyOf(privateKey, prefix = STEEM_KEY_PREFIX) {
  return encodePublicKey(secp256k1.getPublicKey(privateKey, true), prefix);
}

/**
 * Recovers the public key that produced a Keychain `signBuffer` signature.
 * Verifying a login = recovering the key and checking the account's authority
 * lists it (see SteemWalletProvider).
 * @param {string} message the exact signed text
 * @param {string} signatureHex 130 hex characters
 * @param {string} [prefix]
 * @returns {string | null} "STM…" or null when the signature is malformed
 */
export function recoverSigner(message, signatureHex, prefix = STEEM_KEY_PREFIX) {
  if (typeof message !== "string" || typeof signatureHex !== "string" || !/^[0-9a-f]{130}$/.test(signatureHex)) {
    return null;
  }
  const bytes = Uint8Array.from(signatureHex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
  if (bytes.length !== SIGNATURE_BYTES) {
    return null;
  }
  const recovery = bytes[0] - COMPACT_HEADER_BASE - COMPRESSED_FLAG;
  if (recovery < 0 || recovery > 3) {
    return null;
  }
  try {
    const signature = secp256k1.Signature.fromBytes(bytes.slice(1), "compact").addRecoveryBit(recovery);
    const point = signature.recoverPublicKey(sha256(new TextEncoder().encode(message)));
    return encodePublicKey(point.toBytes(true), prefix);
  } catch {
    return null;
  }
}

/**
 * Signs like Keychain's signBuffer (used by tests and by server-side tools
 * that act for the game's own accounts, never for users).
 * @param {string} message
 * @param {Uint8Array} privateKey
 * @returns {string} 130 hex characters
 */
export function signMessage(message, privateKey) {
  const recovered = secp256k1.sign(sha256(new TextEncoder().encode(message)), privateKey, { prehash: false, format: "recovered" });
  const header = COMPACT_HEADER_BASE + COMPRESSED_FLAG + recovered[0];
  return [header, ...recovered.slice(1)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
