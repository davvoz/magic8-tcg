/**
 * Port for keeping whether the match help is on between visits. Implemented
 * by StoredHelpPreferences (this browser's storage). What it reads back is
 * untrusted: HelpSettings parses it.
 *
 * @typedef {object} HelpPreferences
 * @property {() => unknown} load what was last saved, or null when nothing was
 * @property {(state: import("../help/HelpSettings.js").HelpState) => void} save
 */

export const HELP_PREFERENCES_METHODS = Object.freeze(["load", "save"]);
