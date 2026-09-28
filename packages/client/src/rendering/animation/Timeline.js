/**
 * A chain of Tweens over one record: each stage eases every numeric field
 * from wherever the previous stage left it to its own target. A stage whose
 * target equals the current value is a hold. Time is fed in by the game loop
 * (`update(dt)`), never read from a clock here.
 */
import { Tween } from "./Tween.js";

/**
 * @template {Record<string, number>} T
 * @typedef {{ to: T, durationMs: number, easing: (t: number) => number }} Stage
 */

/**
 * @template {Record<string, number>} T
 */
export class Timeline {
  /** @type {T} */
  #state;
  /** Stages not started yet, in order. @type {Stage<T>[]} */
  #stages;
  /** @type {Tween<T> | null} */
  #tween = null;

  /**
   * @param {{ from: T, stages: readonly Stage<T>[] }} options
   */
  constructor({ from, stages }) {
    this.#state = { ...from };
    this.#stages = [...stages];
    this.#advance();
  }

  /** @returns {T} the record as it stands now */
  get frame() {
    return this.#state;
  }

  get isDone() {
    return this.#tween === null;
  }

  /**
   * @param {number} dtMs
   * @returns {boolean} whether any field changed — false through a hold, where the frame need not be redrawn
   */
  update(dtMs) {
    if (this.#tween === null) {
      return false;
    }
    const previous = this.#state;
    this.#state = this.#tween.update(dtMs);
    if (this.#tween.isDone) {
      this.#advance();
    }
    return !sameRecord(previous, this.#state);
  }

  /** Starts the next stage from the current state; none once all have played. */
  #advance() {
    const stage = this.#stages.shift();
    this.#tween = stage === undefined ? null : new Tween({ from: this.#state, to: stage.to, durationMs: stage.durationMs, easing: stage.easing });
  }
}

/**
 * @param {Record<string, number>} a
 * @param {Record<string, number>} b
 */
function sameRecord(a, b) {
  return Object.keys(a).every((key) => a[key] === b[key]);
}
