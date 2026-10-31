/**
 * Keeps the game's screen still while the phone's bars come and go.
 *
 * The installed app plays full screen. Pulling the notification shade down
 * brings the status and navigation bars back for a moment, and the page
 * shrinks by their height (or the safe area grows by it) until they go away
 * again: laid out anew each time, every screen would jump twice. Held, the
 * game keeps its size and its layout, and the bars pass over its edge.
 *
 * A reading is held only while it is a bar's worth smaller than the largest
 * seen: a real change (the phone turned, the screen split in two) is
 * followed at once, and so is any growth (the bars hidden at launch).
 */
const EDGES = /** @type {const} */ (["top", "right", "bottom", "left"]);

/**
 * What the screen measures: its size in CSS pixels and its unsafe edges.
 * @typedef {Readonly<{ cssWidth: number, cssHeight: number, insets: Readonly<Partial<import("./Viewport.js").Insets>> }>} ScreenReading
 */

export class BarsHold {
  #active;
  #tolerance;
  /** @type {ScreenReading | null} */
  #held = null;

  /**
   * @param {{ active: () => boolean, tolerance?: number }} options `active`: whether the app is full screen, where the bars
   *   only pass; `tolerance`: the most, in CSS pixels, the bars take from a side
   */
  constructor({ active, tolerance = 80 }) {
    this.#active = active;
    this.#tolerance = tolerance;
  }

  /** Whether readings are held (the app full screen): the canvas is then sized to the held reading, not to the page. */
  get active() {
    return this.#active();
  }

  /**
   * The reading to lay the game out for.
   * @param {ScreenReading} reading
   * @returns {ScreenReading}
   */
  settle(reading) {
    const held = this.#held;
    if (!this.#active() || held === null || this.#changed(held, reading)) {
      this.#held = this.#active() ? reading : null;
      return reading;
    }
    this.#held = Object.freeze({
      cssWidth: Math.max(held.cssWidth, reading.cssWidth),
      cssHeight: Math.max(held.cssHeight, reading.cssHeight),
      insets: Object.freeze(Object.fromEntries(EDGES.map((edge) => [edge, Math.min(held.insets[edge] ?? 0, reading.insets[edge] ?? 0)]))),
    });
    return this.#held;
  }

  /**
   * More than the bars could explain: turned, or shrunk by more than a bar.
   * @param {ScreenReading} held
   * @param {ScreenReading} reading
   */
  #changed(held, reading) {
    const turned = held.cssWidth >= held.cssHeight !== reading.cssWidth >= reading.cssHeight;
    return turned || held.cssWidth - reading.cssWidth > this.#tolerance || held.cssHeight - reading.cssHeight > this.#tolerance;
  }
}
