/**
 * SelectedDeckPreferences in this browser's storage: the deck the player
 * plays with, under one key (StoredPreference).
 */
import { StoredPreference } from "./StoredPreference.js";

export const SELECTED_DECK_STORAGE_KEY = "magic8.selectedDeck";
export const SELECTED_DECK_SCHEMA_VERSION = 1;
const MAX_STORED_BYTES = 256;

/** @typedef {import("../../application/ports/SelectedDeckPreferences.contract.js").SelectedDeckPreferences} SelectedDeckPreferences */

/** @implements {SelectedDeckPreferences} */
export class StoredSelectedDeck extends StoredPreference {
  /** @param {{ store: import("./KeyValueStore.contract.js").KeyValueStore, logger: import("../../application/ports/Logger.contract.js").Logger }} deps */
  constructor(deps) {
    super(deps, { key: SELECTED_DECK_STORAGE_KEY, schemaVersion: SELECTED_DECK_SCHEMA_VERSION, maxBytes: MAX_STORED_BYTES, name: "selected deck" });
  }
}
