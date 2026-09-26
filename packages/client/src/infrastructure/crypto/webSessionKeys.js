/**
 * SessionKeys on WebCrypto: P-256 key pairs whose private half cannot be
 * exported (a script injected into the page could use it while the page is
 * open, but never carry it away), and the protocol's texts to sign.
 */
import { moveMessage, sessionAuthorization } from "@magic8/protocol";

const ALGORITHM = Object.freeze({ name: "ECDSA", namedCurve: "P-256" });
const SIGNING = Object.freeze({ name: "ECDSA", hash: "SHA-256" });
const encoder = new globalThis.TextEncoder();

/** @param {ArrayBuffer} buffer */
const toHex = (buffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** @typedef {import("../../application/ports/SessionKeys.contract.js").SessionKeys} SessionKeys */

/** @implements {SessionKeys} */
export class WebCryptoSessionKeys {
  #subtle;
  /** @type {Map<string, CryptoKey>} game → private key */
  #keys = new Map();

  /** @param {{ subtle: SubtleCrypto }} deps */
  constructor({ subtle }) {
    this.#subtle = subtle;
  }

  /** @param {string} gameId */
  async create(gameId) {
    const pair = /** @type {CryptoKeyPair} */ (await this.#subtle.generateKey(ALGORITHM, false, ["sign", "verify"]));
    const key = toHex(await this.#subtle.exportKey("raw", pair.publicKey));
    this.#keys.set(gameId, pair.privateKey);
    return Object.freeze({ key, authorizationText: sessionAuthorization(gameId, key) });
  }

  /** @param {string} gameId */
  has(gameId) {
    return this.#keys.has(gameId);
  }

  /** @param {import("../../application/ports/SessionKeys.contract.js").MoveToSign} move */
  async sign(move) {
    const privateKey = this.#keys.get(move.gameId);
    if (privateKey === undefined) {
      return null;
    }
    return toHex(await this.#subtle.sign(SIGNING, privateKey, encoder.encode(moveMessage(move))));
  }

  /** @param {string} gameId */
  forget(gameId) {
    this.#keys.delete(gameId);
  }
}
