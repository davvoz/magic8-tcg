/**
 * The deck the player plays with, wherever they play: chosen once (on the
 * Play screen, or in any screen that lists decks) and taken up by practice,
 * online play and the daily challenges, and kept between visits. It is the
 * deck's id as the player's decks know it (DeckSelectionService's, the deck
 * builder's); the lists of other screens name it too (an online deck's
 * `localId`).
 *
 * A screen asks it which of its decks to start on (`pick`): the chosen one
 * while that one can be played there, else the first that can.
 */

/**
 * @typedef {Readonly<{ deckId: string | null }>} SelectedDeckState
 */

const MAX_ID_LENGTH = 128;

export class SelectedDeck {
  #preferences;
  /** @type {string | null} */
  #deckId;
  /** @type {Set<(state: SelectedDeckState) => void>} */
  #listeners = new Set();

  /** @param {{ preferences: import("../ports/SelectedDeckPreferences.contract.js").SelectedDeckPreferences }} deps */
  constructor({ preferences }) {
    this.#preferences = preferences;
    this.#deckId = parseSelectedDeck(preferences.load());
  }

  /** The chosen deck's id, or null before the player chose one. */
  get deckId() {
    return this.#deckId;
  }

  /** @param {string} deckId */
  choose(deckId) {
    if (deckId === this.#deckId || deckId.length === 0 || deckId.length > MAX_ID_LENGTH) {
      return;
    }
    this.#deckId = deckId;
    this.#preferences.save(Object.freeze({ deckId }));
    const state = Object.freeze({ deckId });
    this.#listeners.forEach((listener) => listener(state));
  }

  /**
   * The deck a screen starts on, among its own: the chosen one when it is there and can be played, else the
   * first that can be played; null when none can.
   * @template T
   * @param {readonly T[]} decks the screen's, in its order
   * @param {{ idOf: (deck: T) => string, playable?: (deck: T) => boolean }} read how its decks name the deck, and
   *   whether each can be played there (all, by default)
   * @returns {T | null}
   */
  pick(decks, { idOf, playable = () => true }) {
    const usable = decks.filter((deck) => playable(deck));
    return usable.find((deck) => idOf(deck) === this.#deckId) ?? usable[0] ?? null;
  }

  /**
   * @param {(state: SelectedDeckState) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

/**
 * @param {unknown} raw what was stored, from anywhere
 * @returns {string | null}
 */
export function parseSelectedDeck(raw) {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const { deckId } = /** @type {Record<string, unknown>} */ (raw);
  return typeof deckId === "string" && deckId.length > 0 && deckId.length <= MAX_ID_LENGTH ? deckId : null;
}
