/**
 * What the challenge characters say, on its way to the table: the
 * DailyCompanion decides when a character speaks, the match shows it as a
 * speech bubble by the character's seat. A line is not a notification: it
 * belongs to the game being played, and is gone when that game is.
 *
 * The match may open just after a line is said (the intro is said as the
 * game starts, while the screen is still handing over), so the voice keeps
 * the last line for a moment: a board that opens in time still hears it.
 */

/** @typedef {import("./DailyCompanion.js").Speech} Speech */

/** How long the last line may still be heard by a board that opens late, in ms. */
export const LATE_HEARING_MS = 4000;

export class CharacterVoice {
  #now;
  /** @type {Set<(speech: Speech) => void>} */
  #listeners = new Set();
  /** @type {{ speech: Speech, atMs: number } | null} */
  #last = null;

  /** @param {{ now: () => number }} clock */
  constructor({ now }) {
    this.#now = now;
  }

  /** @param {Speech} speech */
  say(speech) {
    this.#last = { speech, atMs: this.#now() };
    this.#listeners.forEach((listener) => listener(speech));
  }

  /**
   * @param {(speech: Speech) => void} listener
   * @returns {() => void} stops listening
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * The line just said in this game, if it was said a moment ago.
   * @param {string | undefined} gameId
   * @returns {Speech | null}
   */
  justSaidIn(gameId) {
    const last = this.#last;
    if (last === null || gameId === undefined || last.speech.gameId !== gameId || this.#now() - last.atMs > LATE_HEARING_MS) {
      return null;
    }
    return last.speech;
  }
}
