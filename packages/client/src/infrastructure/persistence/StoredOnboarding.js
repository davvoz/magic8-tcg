/**
 * OnboardingPreferences over a KeyValueStore: the first-time guide's steps
 * done in this browser, under one key, in a versioned envelope. What is
 * read back is handed over as it is found (OnboardingProgress parses it);
 * anything unreadable is logged and forgotten.
 */
import { openEnvelope, sealEnvelope } from "./StorageEnvelope.js";

export const ONBOARDING_STORAGE_KEY = "magic8.onboarding";
export const ONBOARDING_SCHEMA_VERSION = 1;
/** Room for a handful of accounts signed in from this browser. */
const MAX_STORED_BYTES = 4096;

/** @typedef {import("../../application/ports/OnboardingPreferences.contract.js").OnboardingPreferences} OnboardingPreferences */

/** @implements {OnboardingPreferences} */
export class StoredOnboarding {
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
    const raw = this.#store.read(ONBOARDING_STORAGE_KEY);
    if (!raw.ok || raw.value === null) {
      return null;
    }
    const envelope = openEnvelope(raw.value, { schemaVersion: ONBOARDING_SCHEMA_VERSION, maxBytes: MAX_STORED_BYTES });
    if (!envelope.ok) {
      this.#logger.warn("stored onboarding progress discarded", envelope.error);
      return null;
    }
    return envelope.value;
  }

  /** @param {import("../../application/onboarding/OnboardingProgress.js").OnboardingRecord} record */
  save(record) {
    const sealed = sealEnvelope(ONBOARDING_SCHEMA_VERSION, record, MAX_STORED_BYTES);
    const written = sealed.ok ? this.#store.write(ONBOARDING_STORAGE_KEY, sealed.value) : sealed;
    if (!written.ok) {
      this.#logger.warn("onboarding progress not saved", written.error);
    }
  }
}
