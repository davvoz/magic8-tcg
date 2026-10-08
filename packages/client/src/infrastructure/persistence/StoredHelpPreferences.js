/**
 * HelpPreferences over a KeyValueStore: whether the match help is on, under
 * one key, in a versioned envelope. What is read back is handed over as it
 * is found (HelpSettings parses it); anything unreadable is logged and forgotten.
 */
import { openEnvelope, sealEnvelope } from "./StorageEnvelope.js";

export const HELP_STORAGE_KEY = "magic8.help";
export const HELP_SCHEMA_VERSION = 1;
const MAX_STORED_BYTES = 256;

/** @typedef {import("../../application/ports/HelpPreferences.contract.js").HelpPreferences} HelpPreferences */

/** @implements {HelpPreferences} */
export class StoredHelpPreferences {
  #store;
  #logger;

  /**
   * @param {{ store: import("./KeyValueStore.contract.js").KeyValueStore, logger: import("../../application/ports/Logger.contract.js").Logger }} deps
   */
  constructor({ store, logger }) {
    this.#store = store;
    this.#logger = logger;
  }

  /** @returns {unknown} */
  load() {
    const raw = this.#store.read(HELP_STORAGE_KEY);
    if (!raw.ok || raw.value === null) {
      return null;
    }
    const envelope = openEnvelope(raw.value, { schemaVersion: HELP_SCHEMA_VERSION, maxBytes: MAX_STORED_BYTES });
    if (!envelope.ok) {
      this.#logger.warn("stored help setting discarded", envelope.error);
      return null;
    }
    return envelope.value;
  }

  /** @param {import("../../application/help/HelpSettings.js").HelpState} state */
  save(state) {
    const sealed = sealEnvelope(HELP_SCHEMA_VERSION, { enabled: state.enabled }, MAX_STORED_BYTES);
    const written = sealed.ok ? this.#store.write(HELP_STORAGE_KEY, sealed.value) : sealed;
    if (!written.ok) {
      this.#logger.warn("help setting not saved", written.error);
    }
  }
}
