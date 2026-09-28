/**
 * The announcement of a new turn: a band of light sweeps across the middle
 * of the table with whose turn it is written large on it, holds a moment and
 * fades. The ribbon on the board says the same thing all the time; this is
 * the moment the turn changes hands, which the ribbon alone lets slip by.
 *
 * Presentation state only, like CastReveal: a chain of Tweens over one
 * record, fed by the loop, with no drawing and no clock of its own. The
 * painter reads `frame`: `alpha` for the whole thing, `band` how far the
 * band has opened (0 closed, 1 full height), `sweep` the text sliding in
 * (1 off to the side, 0 in place) and `scale` the text's size.
 */
import { Timeline } from "../animation/Timeline.js";
import { Easing } from "../animation/Tween.js";

/** @typedef {{ alpha: number, band: number, sweep: number, scale: number }} TurnFrame */

/** How long the banner is held still, as a multiple of the long duration. */
const HOLD = 1.3;
/** Where the text starts: enlarged, and pushed off to one side. */
const ENTRY = Object.freeze({ scale: 1.35, sweep: 1 });

export class TurnBanner {
  #playerId;
  #turnNumber;
  /** @type {Timeline<TurnFrame>} */
  #timeline;

  /**
   * @param {{ playerId: string, turnNumber: number, animation: Readonly<Record<string, number>> }} options
   */
  constructor({ playerId, turnNumber, animation }) {
    this.#playerId = playerId;
    this.#turnNumber = turnNumber;
    const shown = { alpha: 1, band: 1, sweep: 0, scale: 1 };
    this.#timeline = new Timeline({
      from: { alpha: 0, band: 0, sweep: ENTRY.sweep, scale: ENTRY.scale },
      stages: [
        { to: shown, durationMs: animation.longMs, easing: Easing.easeOutBack },
        { to: shown, durationMs: animation.longMs * HOLD, easing: Easing.linear },
        { to: { alpha: 0, band: 0.6, sweep: -0.4, scale: 1 }, durationMs: animation.mediumMs, easing: Easing.easeInCubic },
      ],
    });
  }

  /** Whose turn is starting. */
  get playerId() {
    return this.#playerId;
  }

  get turnNumber() {
    return this.#turnNumber;
  }

  /** @returns {TurnFrame} */
  get frame() {
    return this.#timeline.frame;
  }

  get isDone() {
    return this.#timeline.isDone;
  }

  /**
   * @param {number} dtMs
   * @returns {boolean} whether the drawn state changed
   */
  update(dtMs) {
    return this.#timeline.update(dtMs);
  }
}
