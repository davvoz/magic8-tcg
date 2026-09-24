/**
 * Encryption of secrets at rest (docs/tcg/04-modello-dati.md §5): pack epoch
 * secrets and, from M4, game secrets. AES-256-GCM with a key that lives in
 * the environment, never in the database or the repository, so a database
 * dump alone reveals no future pack and no running game.
 *
 * Sealed layout: version byte ‖ key id byte ‖ 12-byte IV ‖ 16-byte tag ‖ ciphertext.
 * The additional authenticated data binds a ciphertext to its row (e.g.
 * "rng_epoch:3"): a secret copied into another row does not decrypt.
 */
import { createCipheriv, createDecipheriv } from "node:crypto";

const FORMAT_VERSION = 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 2 + IV_BYTES + TAG_BYTES;

export class SecretBox {
  #keys;
  #currentKeyId;
  #random;

  /**
   * @param {{ keys: ReadonlyMap<number, Uint8Array>, currentKeyId: number, random: import("../random.js").SecureRandom }} deps
   *   older keys stay listed so data sealed before a rotation still opens
   */
  constructor({ keys, currentKeyId, random }) {
    for (const [id, key] of keys) {
      if (!Number.isInteger(id) || id < 0 || id > 255 || !(key instanceof Uint8Array) || key.length !== KEY_BYTES) {
        throw new TypeError("SecretBox: keys are 32 bytes, ids 0..255");
      }
    }
    if (!keys.has(currentKeyId)) {
      throw new TypeError("SecretBox: the current key id has no key");
    }
    this.#keys = keys;
    this.#currentKeyId = currentKeyId;
    this.#random = random;
  }

  /**
   * @param {Uint8Array} plaintext
   * @param {string} context additional authenticated data, e.g. "rng_epoch:3"
   * @returns {Uint8Array}
   */
  seal(plaintext, context) {
    const iv = this.#random.bytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", /** @type {Uint8Array} */ (this.#keys.get(this.#currentKeyId)), iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return new Uint8Array(Buffer.concat([Buffer.from([FORMAT_VERSION, this.#currentKeyId]), iv, cipher.getAuthTag(), ciphertext]));
  }

  /**
   * @param {Uint8Array} sealed
   * @param {string} context must equal the one used to seal
   * @returns {Uint8Array}
   */
  open(sealed, context) {
    if (!(sealed instanceof Uint8Array) || sealed.length < HEADER_BYTES || sealed[0] !== FORMAT_VERSION) {
      throw new Error("SecretBox: not a sealed secret");
    }
    const key = this.#keys.get(sealed[1]);
    if (key === undefined) {
      throw new Error(`SecretBox: no key with id ${sealed[1]}`);
    }
    const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(2, 2 + IV_BYTES));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(sealed.subarray(2 + IV_BYTES, HEADER_BYTES));
    return new Uint8Array(Buffer.concat([decipher.update(sealed.subarray(HEADER_BYTES)), decipher.final()]));
  }
}
