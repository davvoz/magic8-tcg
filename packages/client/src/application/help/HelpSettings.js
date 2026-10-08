/**
 * Whether the match help is on: a line over the table saying which phase it
 * is and what can be done in it, and rings round the cards and buttons that
 * can be used right now. Not a tutorial: it follows any match, and the
 * player turns it off (and on again) from the board whenever they like.
 *
 * On until the player turns it off; the choice is the player's, loaded once
 * and saved on every change. What is read back is untrusted: anything but a
 * stored `{ enabled: boolean }` means the default.
 */

/** @typedef {Readonly<{ enabled: boolean }>} HelpState */

/** New players get the help; those who know the game turn it off. */
export const DEFAULT_HELP_ENABLED = true;

export class HelpSettings {
  #preferences;
  #enabled;
  /** @type {Set<(enabled: boolean) => void>} */
  #listeners = new Set();

  /**
   * @param {{ preferences: import("../ports/HelpPreferences.contract.js").HelpPreferences }} deps
   */
  constructor({ preferences }) {
    this.#preferences = preferences;
    this.#enabled = parseHelpEnabled(preferences.load());
  }

  get enabled() {
    return this.#enabled;
  }

  /** @param {boolean} enabled */
  setEnabled(enabled) {
    if (enabled === this.#enabled) {
      return;
    }
    this.#enabled = enabled;
    this.#preferences.save({ enabled });
    for (const listener of this.#listeners) {
      listener(enabled);
    }
  }

  /** Off if it was on, on if it was off. */
  toggle() {
    this.setEnabled(!this.#enabled);
  }

  /**
   * @param {(enabled: boolean) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

/**
 * @param {unknown} raw what was stored, from anywhere
 * @returns {boolean}
 */
export function parseHelpEnabled(raw) {
  if (raw === null || typeof raw !== "object") {
    return DEFAULT_HELP_ENABLED;
  }
  const { enabled } = /** @type {Record<string, unknown>} */ (raw);
  return typeof enabled === "boolean" ? enabled : DEFAULT_HELP_ENABLED;
}
