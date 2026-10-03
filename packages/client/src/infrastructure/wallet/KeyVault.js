/**
 * Secrets kept in this browser's storage, encrypted with AES-GCM (256-bit).
 * Each secret is bound to its name (the AES-GCM additional data), so one
 * stored blob cannot be passed off as another.
 *
 * - `seal`/`open`: encrypted with the device key, a random AES key kept in
 *   the same storage. It only keeps the secret from being read at a glance
 *   (someone looking at the storage sees no key); whoever can read all of
 *   the browser's data can decrypt it.
 * - `sealWithPin`/`openWithPin`: encrypted with a key derived from a PIN
 *   (PBKDF2-SHA-256, a random salt per secret). The PIN is never stored; a
 *   wrong one fails AES-GCM's authentication.
 *
 * Stored as JSON: { v: 1, iv, data } and, with a PIN, { v: 1, salt, iterations, iv, data }
 * (binary fields in base64).
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { KeyFailure } from "../../application/ports/LocalKeys.contract.js";

const VERSION = 1;
const DEVICE_KEY = "device";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const SALT_BYTES = 16;
/** OWASP's figure for PBKDF2-HMAC-SHA-256 (2023). */
const DEFAULT_ITERATIONS = 600_000;
const MAX_ITERATIONS = 10_000_000;
const AES = "AES-GCM";

const encoder = new globalThis.TextEncoder();
const decoder = new globalThis.TextDecoder();

/** @param {Uint8Array} bytes */
const toBase64 = (bytes) => globalThis.btoa(String.fromCodePoint(...bytes));

/**
 * @param {unknown} text
 * @returns {Uint8Array<ArrayBuffer> | null}
 */
function fromBase64(text) {
  if (typeof text !== "string") {
    return null;
  }
  try {
    return Uint8Array.from(globalThis.atob(text), (character) => character.codePointAt(0) ?? 0);
  } catch {
    return null;
  }
}

export class KeyVault {
  #store;
  #subtle;
  #randomBytes;
  #prefix;
  #iterations;
  /** @type {Promise<CryptoKey> | null} */
  #deviceKey = null;

  /**
   * @param {{
   *   store: import("../persistence/KeyValueStore.contract.js").KeyValueStore,
   *   subtle: SubtleCrypto,
   *   randomBytes: (length: number) => Uint8Array<ArrayBuffer>,
   *   prefix?: string,
   *   iterations?: number,
   * }} deps `iterations`: PBKDF2's, for new PIN-sealed secrets (stored with each, so it can change)
   */
  constructor({ store, subtle, randomBytes, prefix = "magic8.keys.", iterations = DEFAULT_ITERATIONS }) {
    this.#store = store;
    this.#subtle = subtle;
    this.#randomBytes = randomBytes;
    this.#prefix = prefix;
    this.#iterations = iterations;
  }

  /** @param {string} name */
  has(name) {
    const stored = this.#store.read(this.#prefix + name);
    return stored.ok && stored.value !== null;
  }

  /**
   * Whether the stored secret needs a PIN.
   * @param {string} name
   */
  needsPin(name) {
    return this.#read(name)?.salt !== undefined;
  }

  /** @param {string} name */
  remove(name) {
    this.#store.delete(this.#prefix + name);
  }

  /**
   * @param {string} name
   * @param {string} secret
   */
  async seal(name, secret) {
    try {
      return this.#write(name, await this.#encrypt(await this.#device(), name, secret), {});
    } catch {
      return fail(KeyFailure.STORAGE, "this browser could not encrypt the key");
    }
  }

  /**
   * @param {string} name
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<string | null> | import("@magic8/engine/shared/Result.js").Fail>} null when nothing is stored
   */
  async open(name) {
    const stored = this.#read(name);
    if (stored === null) {
      return ok(null);
    }
    if (stored.salt !== undefined) {
      return fail(KeyFailure.WRONG_PIN, "this key is protected by a PIN");
    }
    try {
      return ok(await this.#decrypt(await this.#device(), name, stored));
    } catch {
      return fail(KeyFailure.STORAGE, "the saved key could not be read");
    }
  }

  /**
   * @param {string} name
   * @param {string} secret
   * @param {string} pin
   */
  async sealWithPin(name, secret, pin) {
    const salt = this.#randomBytes(SALT_BYTES);
    try {
      const key = await this.#fromPin(pin, salt, this.#iterations);
      return this.#write(name, await this.#encrypt(key, name, secret), { salt: toBase64(salt), iterations: this.#iterations });
    } catch {
      return fail(KeyFailure.STORAGE, "this browser could not encrypt the key");
    }
  }

  /**
   * @param {string} name
   * @param {string} pin
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<string | null> | import("@magic8/engine/shared/Result.js").Fail>} null when nothing is stored
   */
  async openWithPin(name, pin) {
    const stored = this.#read(name);
    if (stored === null) {
      return ok(null);
    }
    const salt = fromBase64(stored.salt);
    if (salt === null || !Number.isSafeInteger(stored.iterations) || stored.iterations < 1 || stored.iterations > MAX_ITERATIONS) {
      return fail(KeyFailure.STORAGE, "the saved key could not be read");
    }
    try {
      return ok(await this.#decrypt(await this.#fromPin(pin, salt, stored.iterations), name, stored));
    } catch {
      return fail(KeyFailure.WRONG_PIN, "wrong PIN");
    }
  }

  /**
   * @param {string} name
   * @returns {Record<string, any> | null} the stored envelope, null when absent or unreadable
   */
  #read(name) {
    const stored = this.#store.read(this.#prefix + name);
    if (!stored.ok || stored.value === null) {
      return null;
    }
    try {
      const envelope = JSON.parse(stored.value);
      return envelope !== null && typeof envelope === "object" && envelope.v === VERSION ? envelope : null;
    } catch {
      return null;
    }
  }

  /**
   * @param {string} name
   * @param {{ iv: Uint8Array, data: Uint8Array }} sealed
   * @param {Record<string, unknown>} extra
   */
  #write(name, { iv, data }, extra) {
    const written = this.#store.write(this.#prefix + name, JSON.stringify({ v: VERSION, ...extra, iv: toBase64(iv), data: toBase64(data) }));
    return written.ok ? ok(undefined) : fail(KeyFailure.STORAGE, "this browser could not store the key");
  }

  /**
   * @param {CryptoKey} key
   * @param {string} name
   * @param {string} secret
   */
  async #encrypt(key, name, secret) {
    const iv = this.#randomBytes(IV_BYTES);
    const data = new Uint8Array(await this.#subtle.encrypt({ name: AES, iv, additionalData: encoder.encode(name) }, key, encoder.encode(secret)));
    return { iv, data };
  }

  /**
   * @param {CryptoKey} key
   * @param {string} name
   * @param {Record<string, any>} stored
   * @throws when the envelope is malformed or the key does not open it
   */
  async #decrypt(key, name, stored) {
    const iv = fromBase64(stored.iv);
    const data = fromBase64(stored.data);
    if (iv === null || data === null) {
      throw new TypeError("malformed envelope");
    }
    return decoder.decode(await this.#subtle.decrypt({ name: AES, iv, additionalData: encoder.encode(name) }, key, data));
  }

  /** The device key, created on first use. */
  #device() {
    this.#deviceKey ??= this.#loadDeviceKey().catch((error) => {
      this.#deviceKey = null;
      throw error;
    });
    return this.#deviceKey;
  }

  async #loadDeviceKey() {
    const stored = this.#store.read(this.#prefix + DEVICE_KEY);
    let raw = stored.ok ? fromBase64(stored.value) : null;
    if (raw === null || raw.length !== KEY_BYTES) {
      raw = this.#randomBytes(KEY_BYTES);
      const written = this.#store.write(this.#prefix + DEVICE_KEY, toBase64(raw));
      if (!written.ok) {
        throw new Error("the device key could not be stored");
      }
    }
    return this.#subtle.importKey("raw", raw, AES, false, ["encrypt", "decrypt"]);
  }

  /**
   * @param {string} pin
   * @param {Uint8Array<ArrayBuffer>} salt
   * @param {number} iterations
   */
  async #fromPin(pin, salt, iterations) {
    const material = await this.#subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveKey"]);
    return this.#subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, { name: AES, length: 256 }, false, ["encrypt", "decrypt"]);
  }
}
