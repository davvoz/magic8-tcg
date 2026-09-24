/**
 * Presentation state of one card on the board: where it is drawn right now
 * and where it is heading. Hit-testing uses layout targets, never these
 * tweened positions, so a card is tappable at its final slot as soon as the
 * snapshot says it is there.
 */
import { Tween } from "../animation/Tween.js";

/** How far (fraction of the distance) a nudge travels toward its target. */
const NUDGE_FRACTION = 0.25;

/** @typedef {{ x: number, y: number, width: number, height: number, alpha: number }} VisualState */

export class CardVisual {
  /** @type {string} */
  instanceId;
  /** @type {VisualState} */
  state;
  /** @type {Tween<VisualState> | null} */
  #tween = null;
  /** Tweens to run after the current one (used by the attack nudge). @type {Tween<VisualState>[]} */
  #queue = [];
  /** Where the card rests when nothing is animating (its layout slot). @type {VisualState | null} */
  #home = null;
  /** Set when the card left the board; removed once the exit tween finishes. */
  #leaving = false;

  /**
   * @param {string} instanceId
   * @param {VisualState} initial
   */
  constructor(instanceId, initial) {
    this.instanceId = instanceId;
    this.state = { ...initial };
  }

  get isAnimating() {
    return (this.#tween !== null && !this.#tween.isDone) || this.#queue.length > 0;
  }

  get isLeaving() {
    return this.#leaving;
  }

  /** True once a leaving card has faded out and can be dropped. */
  get isGone() {
    return this.#leaving && !this.isAnimating;
  }

  /**
   * @param {import("@magic8/engine/shared/geometry.js").Rect} target
   * @param {number} durationMs
   */
  moveTo(target, durationMs) {
    const to = { x: target.x, y: target.y, width: target.width, height: target.height, alpha: 1 };
    this.#home = to;
    this.#queue = [];
    if (sameState(this.state, to)) {
      this.#tween = null;
      return;
    }
    this.#tween = new Tween({ from: this.state, to, durationMs });
    if (durationMs === 0) {
      this.state = to;
      this.#tween = null;
    }
  }

  /**
   * Shrinks toward `target` while fading, then reports `isGone`.
   * @param {import("@magic8/engine/shared/geometry.js").Rect} target
   * @param {number} durationMs
   */
  leaveTo(target, durationMs) {
    this.#leaving = true;
    this.#queue = [];
    const to = { x: target.x + target.width / 2, y: target.y + target.height / 2, width: 0, height: 0, alpha: 0 };
    this.#tween = new Tween({ from: this.state, to, durationMs });
    if (durationMs === 0) {
      this.state = to;
      this.#tween = null;
    }
  }

  /**
   * A short lunge a quarter of the way toward `point` and back home; used
   * when this card deals damage. Ignored while leaving or before the card
   * has a home slot.
   * @param {{ x: number, y: number }} point
   * @param {number} durationMs for each leg
   */
  nudgeToward(point, durationMs) {
    const home = this.#home;
    if (this.#leaving || home === null || durationMs === 0) {
      return;
    }
    const centerX = home.x + home.width / 2;
    const centerY = home.y + home.height / 2;
    const mid = { ...home, x: home.x + (point.x - centerX) * NUDGE_FRACTION, y: home.y + (point.y - centerY) * NUDGE_FRACTION };
    this.#tween = new Tween({ from: this.state, to: mid, durationMs });
    this.#queue = [new Tween({ from: mid, to: home, durationMs })];
  }

  /**
   * @param {number} dtMs
   * @returns {boolean} whether the drawn state changed
   */
  update(dtMs) {
    if (this.#tween === null) {
      return false;
    }
    this.state = this.#tween.update(dtMs);
    if (this.#tween.isDone) {
      this.#tween = this.#queue.shift() ?? null;
    }
    return true;
  }
}

/**
 * @param {VisualState} a
 * @param {VisualState} b
 */
function sameState(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.alpha === b.alpha;
}
