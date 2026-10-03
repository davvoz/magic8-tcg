/**
 * Port for keeping the player's sound settings between visits. Implemented
 * by StoredAudioPreferences (this browser's storage). What it reads back is
 * untrusted: AudioService parses it.
 *
 * @typedef {object} AudioPreferences
 * @property {() => unknown} load the settings last saved, or null when there are none
 * @property {(settings: import("../audio/AudioSettings.js").AudioSettings) => void} save
 */

export const AUDIO_PREFERENCES_METHODS = Object.freeze(["load", "save"]);
