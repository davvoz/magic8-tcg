/**
 * SignInRecord over a KeyValueStore: the account and how it signed in,
 * under one key, in a versioned envelope. Nothing secret: no key, only
 * "keychain" or "keys". Anything unreadable reads as nothing remembered.
 */
import { openEnvelope, sealEnvelope } from "./StorageEnvelope.js";

export const SIGN_IN_STORAGE_KEY = "magic8.signin";
const SCHEMA_VERSION = 1;
const MAX_STORED_BYTES = 256;
const METHODS = Object.freeze(["keychain", "keys"]);

/** @typedef {import("../../application/ports/SignInRecord.contract.js").SignInRecord} SignInRecord */

/** @implements {SignInRecord} */
export class StoredSignIn {
  #store;

  /** @param {{ store: import("./KeyValueStore.contract.js").KeyValueStore }} deps */
  constructor({ store }) {
    this.#store = store;
  }

  read() {
    const raw = this.#store.read(SIGN_IN_STORAGE_KEY);
    if (!raw.ok || raw.value === null) {
      return null;
    }
    const envelope = openEnvelope(raw.value, { schemaVersion: SCHEMA_VERSION, maxBytes: MAX_STORED_BYTES });
    const entry = /** @type {any} */ (envelope.ok ? envelope.value : null);
    return typeof entry?.account === "string" && METHODS.includes(entry.method) ? Object.freeze({ account: entry.account, method: entry.method }) : null;
  }

  /** @param {import("../../application/ports/SignInRecord.contract.js").SignInEntry} entry */
  write({ account, method }) {
    const sealed = sealEnvelope(SCHEMA_VERSION, { account, method }, MAX_STORED_BYTES);
    if (sealed.ok) {
      this.#store.write(SIGN_IN_STORAGE_KEY, sealed.value);
    }
  }

  clear() {
    this.#store.delete(SIGN_IN_STORAGE_KEY);
  }
}
