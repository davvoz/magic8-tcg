/**
 * Port for keeping, between visits, what the game cannot ask the server:
 * the steps of the first-time guide a player has done here (the tutorial,
 * a first challenge won, a first online game) and whether they hid the
 * guide. Implemented by StoredOnboarding (this browser's storage). What it
 * reads back is untrusted: OnboardingProgress parses it.
 *
 * @typedef {object} OnboardingPreferences
 * @property {() => unknown} load what was last saved, or null when nothing was
 * @property {(state: import("../onboarding/OnboardingProgress.js").OnboardingRecord) => void} save
 */

export const ONBOARDING_PREFERENCES_METHODS = Object.freeze(["load", "save"]);
