/**
 * A player's preference over a KeyValueStore: one JSON value under one key,
 * in a versioned envelope, capped in size. What is read back is handed over
 * as it is found (the application parses it); anything unreadable is logged
 * and forgotten. The adapters behind the preference ports extend it with
 * their key (StoredOnboarding, StoredSelectedDeck).
 */
import { openEnvelope, sealEnvelope } from "./StorageEnvelope.js";

export class StoredPreference {
  #store;
  #logger;
  #key;
  #schemaVersion;
  #maxBytes;
  #name;

  /**
   * @param {{ store: import("./KeyValueStore.contract.js").KeyValueStore, logger: import("../../application/ports/Logger.contract.js").Logger }} deps
   * @param {{ key: string, schemaVersion: number, maxBytes: number, name: string }} kind `name`: what it is, in the log
   */
  constructor({ store, logger }, { key, schemaVersion, maxBytes, name }) {
    this.#store = store;
    this.#logger = logger;
    this.#key = key;
    this.#schemaVersion = schemaVersion;
    this.#maxBytes = maxBytes;
    this.#name = name;
  }

  /** @returns {unknown} what was last saved, or null when nothing (readable) was */
  load() {
    const raw = this.#store.read(this.#key);
    if (!raw.ok || raw.value === null) {
      return null;
    }
    const envelope = openEnvelope(raw.value, { schemaVersion: this.#schemaVersion, maxBytes: this.#maxBytes });
    if (!envelope.ok) {
      this.#logger.warn(`stored ${this.#name} discarded`, envelope.error);
      return null;
    }
    return envelope.value;
  }

  /** @param {unknown} value JSON-serialisable */
  save(value) {
    const sealed = sealEnvelope(this.#schemaVersion, value, this.#maxBytes);
    const written = sealed.ok ? this.#store.write(this.#key, sealed.value) : sealed;
    if (!written.ok) {
      this.#logger.warn(`${this.#name} not saved`, written.error);
    }
  }
}
