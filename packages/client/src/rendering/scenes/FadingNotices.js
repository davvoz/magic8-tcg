/**
 * Words about something that just happened (a challenge refused, a game called off, a request the server turned down,
 * a listing made) are shown for a while, then forgotten: the screen goes back to what it shows when nothing is going
 * on (its status, its guide). Leaving the screen forgets the ones already shown.
 *
 * A screen ticks it from its `update(dtMs)`; each source says what it shows now and how to forget it (the service's
 * own, so every screen showing it goes back too).
 */

/** How long words about what just happened stay up. */
export const NOTICE_LIFETIME_MS = 10_000;

/**
 * @typedef {Readonly<{ read: () => unknown, forget: () => void }>} NoticeSource `read`: what it shows now, compared by
 *   identity (null or undefined: nothing); `forget`: clears it where it is kept
 */

export class FadingNotices {
  /** @type {readonly NoticeSource[]} */
  #sources;
  #lifetimeMs;
  /** What each source showed when last looked at, and for how long. @type {Map<NoticeSource, { notice: unknown, ageMs: number }>} */
  #shown = new Map();

  /**
   * @param {readonly NoticeSource[]} sources
   * @param {number} [lifetimeMs]
   */
  constructor(sources, lifetimeMs = NOTICE_LIFETIME_MS) {
    this.#sources = sources;
    this.#lifetimeMs = lifetimeMs;
  }

  /**
   * Time passes: what has been up long enough is forgotten (its source tells its watchers, who draw the screen again).
   * @param {number} dtMs
   * @returns {boolean} whether one was forgotten
   */
  tick(dtMs) {
    let forgot = false;
    for (const source of this.#sources) {
      const notice = source.read() ?? null;
      const shown = this.#shown.get(source);
      if (notice === null) {
        this.#shown.delete(source);
        continue;
      }
      // A new notice starts its time afresh.
      const ageMs = shown?.notice === notice ? shown.ageMs + dtMs : 0;
      if (ageMs < this.#lifetimeMs) {
        this.#shown.set(source, { notice, ageMs });
        continue;
      }
      this.#shown.delete(source);
      source.forget();
      forgot = true;
    }
    return forgot;
  }

  /** The screen is left: what it has shown is done with. */
  forgetShown() {
    const shown = [...this.#shown.keys()];
    this.#shown.clear();
    shown.forEach((source) => source.forget());
  }
}
