/**
 * SeasonNewsPreferences in this browser's storage: the season whose news
 * each account signed in here has seen, under one key (StoredPreference).
 */
import { StoredPreference } from "./StoredPreference.js";

export const SEASON_NEWS_STORAGE_KEY = "magic8.seasonNews";
export const SEASON_NEWS_SCHEMA_VERSION = 1;
/** Room for a handful of accounts signed in from this browser. */
const MAX_STORED_BYTES = 2048;

/** @typedef {import("../../application/ports/SeasonNewsPreferences.contract.js").SeasonNewsPreferences} SeasonNewsPreferences */

/** @implements {SeasonNewsPreferences} */
export class StoredSeasonNews extends StoredPreference {
  /** @param {{ store: import("./KeyValueStore.contract.js").KeyValueStore, logger: import("../../application/ports/Logger.contract.js").Logger }} deps */
  constructor(deps) {
    super(deps, { key: SEASON_NEWS_STORAGE_KEY, schemaVersion: SEASON_NEWS_SCHEMA_VERSION, maxBytes: MAX_STORED_BYTES, name: "season news seen" });
  }
}
