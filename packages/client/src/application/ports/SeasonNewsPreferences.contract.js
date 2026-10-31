/**
 * Port for keeping, between visits, which season's news each account signed
 * in from this browser has already been shown (SeasonNewsService), so it is
 * shown once per season. Implemented by StoredSeasonNews (this browser's
 * storage). What it reads back is untrusted: the service parses it.
 *
 * @typedef {object} SeasonNewsPreferences
 * @property {() => unknown} load what was last saved, or null when nothing was
 * @property {(state: import("../season/SeasonNewsService.js").SeenRecord) => void} save
 */

export const SEASON_NEWS_PREFERENCES_METHODS = Object.freeze(["load", "save"]);
