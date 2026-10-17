/**
 * OnboardingPreferences in this browser's storage: the first-time guide's
 * steps done here, under one key (StoredPreference).
 */
import { StoredPreference } from "./StoredPreference.js";

export const ONBOARDING_STORAGE_KEY = "magic8.onboarding";
export const ONBOARDING_SCHEMA_VERSION = 1;
/** Room for a handful of accounts signed in from this browser. */
const MAX_STORED_BYTES = 4096;

/** @typedef {import("../../application/ports/OnboardingPreferences.contract.js").OnboardingPreferences} OnboardingPreferences */

/** @implements {OnboardingPreferences} */
export class StoredOnboarding extends StoredPreference {
  /** @param {{ store: import("./KeyValueStore.contract.js").KeyValueStore, logger: import("../../application/ports/Logger.contract.js").Logger }} deps */
  constructor(deps) {
    super(deps, { key: ONBOARDING_STORAGE_KEY, schemaVersion: ONBOARDING_SCHEMA_VERSION, maxBytes: MAX_STORED_BYTES, name: "onboarding progress" });
  }
}
