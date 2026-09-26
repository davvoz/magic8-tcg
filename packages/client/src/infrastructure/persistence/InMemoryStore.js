import { ok } from "@magic8/engine/shared/Result.js";

/** @typedef {import("./KeyValueStore.contract.js").KeyValueStore} KeyValueStore */

/** @implements {KeyValueStore} */
export class InMemoryStore {
  #entries = new Map();

  /** @param {string} key */
  read(key) {
    return ok(this.#entries.get(key) ?? null);
  }

  /**
   * @param {string} key
   * @param {string} value
   */
  write(key, value) {
    this.#entries.set(key, value);
    return ok(undefined);
  }

  /** @param {string} key */
  delete(key) {
    this.#entries.delete(key);
    return ok(undefined);
  }
}
