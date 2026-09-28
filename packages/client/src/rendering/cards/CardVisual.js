/**
 * Presentation state of one card on the board: where it is drawn right now
 * and where it is heading. Hit-testing uses layout targets, never these
 * tweened positions, so a card is tappable at its final slot as soon as the
 * snapshot says it is there.
 *
 * Besides its placement a card carries two short-lived values the painter
 * reads: `flash`, the light of a blow it just took, and `lift`, how far it
 * is raised under the pointer.
 */
import { Easing, Tween } from "../animation/Tween.js";

/** How far (fraction of the distance) an attack lunges toward its target. */
const LUNGE_FRACTION = 0.3;
/** How far (fraction of the distance) it draws back before lunging. */
const WINDUP_FRACTION = 0.06;
/** The way back home takes this many legs' time: slower than the blow. */
const RETURN_LEGS = 2;
/** How long the raise under the pointer takes, either way. */
const LIFT_MS = 110;

/** @typedef {{ x: number, y: number, width: number, height: number, alpha: number }} VisualState */

/**
 * How long after an attack starts its blow lands: the draw-back and the lunge.
 * @param {number} legMs
 */
export function blowLandsAfter(legMs) {
  return 2 * legMs;
}

export class CardVisual {
  /** @type {string} */
  instanceId;
  /** @type {VisualState} */
  state;
  /** @type {Tween<VisualState> | null} */
  #tween = null;
  /** Tweens to run after the current one (the legs of an attack, the exit after a delay). @type {Tween<VisualState>[]} */
  #queue = [];
  /** Where the card rests when nothing is animating (its layout slot). @type {VisualState | null} */
  #home = null;
  /** Set when the card left the board; removed once the exit tween finishes. */
  #leaving = false;
  /** The exit tween of a leaving card, kept so an attack can play before it. @type {Tween<VisualState> | null} */
  #exit = null;
  /** A blow being shown: it lights up when `ageMs` reaches 0 (it starts negative while the blow is on its way), then fades over `durationMs`. @type {{ ageMs: number, durationMs: number } | null} */
  #hit = null;
  #lift = 0;
  #lifted = false;

  /**
   * @param {string} instanceId
   * @param {VisualState} initial
   */
  constructor(instanceId, initial) {
    this.instanceId = instanceId;
    this.state = { ...initial };
  }

  get isAnimating() {
    return (this.#tween !== null && !this.#tween.isDone) || this.#queue.length > 0 || this.#hit !== null || this.#lift !== (this.#lifted ? 1 : 0);
  }

  /** Whether the card is on its way somewhere — landing, attacking, leaving — as opposed to only glowing or lifting. */
  get isMoving() {
    return (this.#tween !== null && !this.#tween.isDone) || this.#queue.length > 0;
  }

  get isLeaving() {
    return this.#leaving;
  }

  /** True once a leaving card has faded out and can be dropped. */
  get isGone() {
    return this.#leaving && this.#tween === null && this.#queue.length === 0;
  }

  /** Whether the card has a slot to attack from and return to. */
  get hasHome() {
    return this.#home !== null;
  }

  /** @returns {number} 0 when untouched, 1 at the instant a blow lands, fading back to 0 */
  get flash() {
    const hit = this.#hit;
    if (hit === null || hit.ageMs < 0) {
      return 0;
    }
    return 1 - Easing.easeOutCubic(Math.min(1, hit.ageMs / hit.durationMs));
  }

  /** @returns {number} 0 at rest, 1 fully raised */
  get lift() {
    return Easing.easeOutCubic(this.#lift);
  }

  /**
   * Raises the card (under the pointer or focus) or lowers it again; the
   * change eases in over the next frames.
   * @param {boolean} lifted
   */
  liftTo(lifted) {
    this.#lifted = lifted;
  }

  /**
   * Eases into the slot, running a touch past it and settling back.
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
    this.#tween = new Tween({ from: this.state, to, durationMs, easing: Easing.easeOutBack });
    if (durationMs === 0) {
      this.state = to;
      this.#tween = null;
    }
  }

  /**
   * Shrinks toward `target` while fading, then reports `isGone`. A card
   * killed by a blow still to land stays put for `delayMs`, so it is seen to
   * be struck before it goes.
   * @param {import("@magic8/engine/shared/geometry.js").Rect} target
   * @param {number} durationMs
   * @param {number} [delayMs]
   */
  leaveTo(target, durationMs, delayMs = 0) {
    this.#leaving = true;
    const to = { x: target.x + target.width / 2, y: target.y + target.height / 2, width: 0, height: 0, alpha: 0 };
    if (durationMs === 0) {
      this.state = to;
      this.#tween = null;
      this.#queue = [];
      this.#exit = null;
      return;
    }
    const from = this.#home ?? this.state;
    this.#exit = new Tween({ from, to, durationMs, easing: Easing.easeInOutQuad });
    if (delayMs > 0) {
      this.#tween = new Tween({ from: this.state, to: from, durationMs: delayMs });
      this.#queue = [this.#exit];
    } else {
      this.#tween = this.#exit;
      this.#queue = [];
    }
  }

  /**
   * An attack toward `point`: the card draws back, lunges part of the way
   * there and returns home — or, if it died in the exchange, then leaves.
   * Ignored before the card has a home slot.
   * @param {{ x: number, y: number }} point
   * @param {number} legMs duration of the draw-back and of the lunge; the return takes longer
   * @returns {number} how long until the blow lands (0 when there is no attack to show)
   */
  nudgeToward(point, legMs) {
    const home = this.#home;
    if (home === null || legMs === 0) {
      return 0;
    }
    const towards = (fraction) => ({ ...home, x: home.x + (point.x - (home.x + home.width / 2)) * fraction, y: home.y + (point.y - (home.y + home.height / 2)) * fraction });
    const windup = towards(-WINDUP_FRACTION);
    const lunge = towards(LUNGE_FRACTION);
    this.#tween = new Tween({ from: this.state, to: windup, durationMs: legMs, easing: Easing.easeOutCubic });
    this.#queue = [new Tween({ from: windup, to: lunge, durationMs: legMs, easing: Easing.easeInCubic }), new Tween({ from: lunge, to: home, durationMs: legMs * RETURN_LEGS, easing: Easing.easeOutBack })];
    if (this.#leaving && this.#exit !== null) {
      this.#queue.push(this.#exit);
    }
    return blowLandsAfter(legMs);
  }

  /**
   * Lights the card up as a blow lands on it, `delayMs` from now.
   * @param {number} delayMs
   * @param {number} durationMs
   */
  hit(delayMs, durationMs) {
    if (durationMs > 0) {
      this.#hit = { ageMs: -delayMs, durationMs };
    }
  }

  /**
   * @param {number} dtMs
   * @returns {boolean} whether the drawn state changed
   */
  update(dtMs) {
    const flashed = this.#updateHit(dtMs);
    const lifted = this.#updateLift(dtMs);
    if (this.#tween === null) {
      return flashed || lifted;
    }
    this.state = this.#tween.update(dtMs);
    if (this.#tween.isDone) {
      this.#tween = this.#queue.shift() ?? null;
    }
    return true;
  }

  /** @param {number} dtMs */
  #updateHit(dtMs) {
    const hit = this.#hit;
    if (hit === null) {
      return false;
    }
    hit.ageMs += dtMs;
    if (hit.ageMs >= hit.durationMs) {
      this.#hit = null;
    }
    return hit.ageMs >= 0;
  }

  /** @param {number} dtMs */
  #updateLift(dtMs) {
    const target = this.#lifted ? 1 : 0;
    if (this.#lift === target) {
      return false;
    }
    const step = dtMs / LIFT_MS;
    this.#lift = target > this.#lift ? Math.min(target, this.#lift + step) : Math.max(target, this.#lift - step);
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
