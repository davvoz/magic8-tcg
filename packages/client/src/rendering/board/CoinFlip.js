/**
 * The animation of the opening coin toss. The table dims and each player's
 * face is shown beside their name; the coin is thrown, spins end over end
 * through its arc and settles on the winning face with a flash of light; the
 * verdict is held long enough to be read, then everything fades back to the
 * board.
 *
 * Presentation state only, like CastReveal: a Timeline over one record, fed
 * by the loop, with no drawing and no clock of its own. The painter reads
 * `frame` — `veil` how dark the table is, `calls` how far the players' faces
 * have come in, `flight` how far through its arc the coin is (0 in the hand,
 * 1 landed), `shine` the flash of the landing, `verdict` the result coming
 * in — and the derived `lift`, `squeeze` and `faceShown`.
 */
import { CoinFace } from "../../application/match/CoinToss.js";
import { Timeline } from "../animation/Timeline.js";
import { Easing } from "../animation/Tween.js";

/**
 * @typedef {{ veil: number, calls: number, flight: number, shine: number, verdict: number }} CoinFrame
 */

/** Whole turns the coin makes in the air, before the last half-turn that may flip it to tails. */
const FULL_TURNS = 4;
/** The face up while the coin rests in the hand. */
const RESTING_FACE = CoinFace.HEADS;
/** Stage lengths, as multiples of the theme's long duration. */
const PACE = Object.freeze({ readCalls: 2, flight: 3, holdVerdict: 2.2 });

export class CoinFlip {
  #toss;
  /** Half-turns the coin makes from the hand to the table: even lands the resting face up, odd the other. */
  #halfTurns;
  /** @type {Timeline<CoinFrame>} */
  #timeline;
  /** How long the coin is in the air. */
  #flightMs;

  /**
   * @param {{ toss: import("../../application/match/CoinToss.js").CoinToss, animation: Readonly<Record<string, number>> }} options
   *   `animation`: theme durations (shortMs, mediumMs, longMs)
   */
  constructor({ toss, animation }) {
    this.#toss = toss;
    this.#halfTurns = 2 * FULL_TURNS + (toss.landed === RESTING_FACE ? 0 : 1);
    this.#flightMs = animation.longMs * PACE.flight;
    const shown = { veil: 1, calls: 1, flight: 0, shine: 0, verdict: 0 };
    const landed = { ...shown, flight: 1 };
    const flashed = { ...landed, shine: 1 };
    const told = { ...flashed, verdict: 1 };
    this.#timeline = new Timeline({
      from: { veil: 0, calls: 0, flight: 0, shine: 0, verdict: 0 },
      stages: [
        { to: shown, durationMs: animation.longMs, easing: Easing.easeOutCubic },
        { to: shown, durationMs: animation.longMs * PACE.readCalls, easing: Easing.linear },
        { to: landed, durationMs: this.#flightMs, easing: Easing.linear },
        { to: flashed, durationMs: animation.longMs, easing: Easing.easeOutCubic },
        { to: told, durationMs: animation.mediumMs, easing: Easing.easeOutCubic },
        { to: told, durationMs: animation.longMs * PACE.holdVerdict, easing: Easing.linear },
        { to: { veil: 0, calls: 0, flight: 1, shine: 1, verdict: 0 }, durationMs: animation.longMs, easing: Easing.easeInOutQuad },
      ],
    });
  }

  /** @returns {import("../../application/match/CoinToss.js").CoinToss} */
  get toss() {
    return this.#toss;
  }

  /** How long the coin is in the air, from the throw to the table. */
  get flightMs() {
    return this.#flightMs;
  }

  /** @returns {CoinFrame} */
  get frame() {
    return this.#timeline.frame;
  }

  get isDone() {
    return this.#timeline.isDone;
  }

  /** @returns {number} height of the coin in its arc: 0 in the hand and on the table, 1 at the top */
  get lift() {
    const { flight } = this.frame;
    return 4 * flight * (1 - flight);
  }

  /** @returns {number} half-turns made so far */
  get spin() {
    return this.frame.flight * this.#halfTurns;
  }

  /** @returns {number} how much of the face is seen: 1 flat to the viewer, 0 edge-on */
  get squeeze() {
    return Math.abs(Math.cos(this.spin * Math.PI));
  }

  /** @returns {string} the face turned towards the viewer right now (a CoinFace) */
  get faceShown() {
    return Math.round(this.spin) % 2 === 0 ? RESTING_FACE : otherFace(RESTING_FACE);
  }

  /** True once the coin is on the table and its face can be read as the result. */
  get hasLanded() {
    return this.frame.flight >= 1;
  }

  /**
   * @param {number} dtMs
   * @returns {boolean} whether the drawn state changed
   */
  update(dtMs) {
    return this.#timeline.update(dtMs);
  }
}

/** @param {string} face */
function otherFace(face) {
  return face === CoinFace.HEADS ? CoinFace.TAILS : CoinFace.HEADS;
}
