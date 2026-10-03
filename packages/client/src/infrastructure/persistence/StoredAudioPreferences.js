/**
 * AudioPreferences over a KeyValueStore: the sound settings under one key,
 * in a versioned envelope. What is read back is handed over as it is found
 * (AudioService parses it); anything unreadable is logged and forgotten.
 */
import { openEnvelope, sealEnvelope } from "./StorageEnvelope.js";

export const AUDIO_STORAGE_KEY = "magic8.audio";
export const AUDIO_SCHEMA_VERSION = 1;
const MAX_STORED_BYTES = 1024;

/** @typedef {import("../../application/ports/AudioPreferences.contract.js").AudioPreferences} AudioPreferences */

/** @implements {AudioPreferences} */
export class StoredAudioPreferences {
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
    const raw = this.#store.read(AUDIO_STORAGE_KEY);
    if (!raw.ok || raw.value === null) {
      return null;
    }
    const envelope = openEnvelope(raw.value, { schemaVersion: AUDIO_SCHEMA_VERSION, maxBytes: MAX_STORED_BYTES });
    if (!envelope.ok) {
      this.#logger.warn("stored sound settings discarded", envelope.error);
      return null;
    }
    return envelope.value;
  }

  /** @param {import("../../application/audio/AudioSettings.js").AudioSettings} settings */
  save(settings) {
    const sealed = sealEnvelope(AUDIO_SCHEMA_VERSION, { music: settings.music, effects: settings.effects, muted: settings.muted }, MAX_STORED_BYTES);
    const written = sealed.ok ? this.#store.write(AUDIO_STORAGE_KEY, sealed.value) : sealed;
    if (!written.ok) {
      this.#logger.warn("sound settings not saved", written.error);
    }
  }
}
