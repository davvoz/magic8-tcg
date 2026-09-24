/**
 * Minimal tweening for presentation state: interpolates every numeric
 * field of a record from `from` to `to` over `durationMs`. Time is fed in
 * by the game loop (`update(dt)`), never read from a clock here.
 */

/** @type {Readonly<Record<string, (t: number) => number>>} */
export const Easing = Object.freeze({
  linear: (t) => t,
  easeOutCubic: (t) => 1 - (1 - t) ** 3,
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
});

/**
 * @template {Record<string, number>} T
 */
export class Tween {
  #from;
  #to;
  #durationMs;
  #easing;
  #elapsed = 0;

  /**
   * @param {{ from: T, to: T, durationMs: number, easing?: (t: number) => number }} options
   */
  constructor({ from, to, durationMs, easing = Easing.easeOutCubic }) {
    this.#from = { ...from };
    this.#to = { ...to };
    this.#durationMs = Math.max(0, durationMs);
    this.#easing = easing;
  }

  get isDone() {
    return this.#elapsed >= this.#durationMs;
  }

  /** @returns {T} */
  get target() {
    return /** @type {T} */ ({ ...this.#to });
  }

  /**
   * @param {number} dtMs
   * @returns {T} the interpolated value after advancing
   */
  update(dtMs) {
    this.#elapsed = Math.min(this.#durationMs, this.#elapsed + Math.max(0, dtMs));
    return this.current;
  }

  /** @returns {T} */
  get current() {
    if (this.isDone) {
      return this.target;
    }
    const progress = this.#easing(this.#elapsed / this.#durationMs);
    /** @type {Record<string, number>} */
    const value = {};
    for (const key of Object.keys(this.#to)) {
      const start = this.#from[key] ?? this.#to[key];
      value[key] = start + (this.#to[key] - start) * progress;
    }
    return /** @type {T} */ (value);
  }
}
