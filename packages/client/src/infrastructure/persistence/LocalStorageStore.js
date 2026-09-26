/**
 * KeyValueStore over the Web Storage API. Every call is guarded: storage can
 * be absent (unsupported), disabled (private mode, blocked cookies) or full
 * (quota), and each of those surfaces as a Result rather than an exception.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { StoreError } from "./KeyValueStore.contract.js";

/** @typedef {import("./KeyValueStore.contract.js").KeyValueStore} KeyValueStore */

/** @implements {KeyValueStore} */
export class LocalStorageStore {
  #storage;

  /** @param {Storage | null | undefined} storage Typically `globalThis.localStorage`; injected for testability. */
  constructor(storage) {
    this.#storage = storage ?? null;
  }

  /** Probes the storage with a write/remove round-trip. */
  isAvailable() {
    if (this.#storage === null) {
      return false;
    }
    const probeKey = "__magic8_probe__";
    try {
      this.#storage.setItem(probeKey, "1");
      this.#storage.removeItem(probeKey);
      return true;
    } catch {
      return false;
    }
  }

  /** @param {string} key */
  read(key) {
    try {
      return ok(this.#storage?.getItem(key) ?? null);
    } catch {
      return fail(StoreError.UNAVAILABLE, "local storage is not readable");
    }
  }

  /**
   * @param {string} key
   * @param {string} value
   */
  write(key, value) {
    if (this.#storage === null) {
      return fail(StoreError.UNAVAILABLE, "local storage is not available");
    }
    try {
      this.#storage.setItem(key, value);
      return ok(undefined);
    } catch {
      return fail(StoreError.WRITE_FAILED, "local storage write failed (quota or disabled)");
    }
  }

  /** @param {string} key */
  delete(key) {
    try {
      this.#storage?.removeItem(key);
      return ok(undefined);
    } catch {
      return fail(StoreError.WRITE_FAILED, "local storage delete failed");
    }
  }
}
