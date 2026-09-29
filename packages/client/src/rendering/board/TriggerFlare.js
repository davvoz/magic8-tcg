/**
 * The moment an ability goes off: a creature arriving or dying, a turn
 * starting, one of our own spells. A rune kindles where the card is — or
 * where it fell, or over the middle of the table for a spell, which has no
 * place on the board — with its name over it, and beams reach out to
 * whatever it is aimed at. What the ability does is shown once they strike,
 * so each link of a chain is seen to come from the one before it.
 *
 * Several abilities announced together (two creatures dying in the same
 * exchange) kindle together, one rune each.
 *
 * Presentation state only, like CastReveal: a chain of Tweens over one
 * record, fed by the loop, with no drawing and no clock of its own. The
 * painter reads `frame`: `alpha` and `glow` for the whole thing, `ring` the
 * rune spreading out of the source, `seek` how far a random discard's
 * crosshair has got through its draw (TargetRoulette; 0 throughout without
 * one) and `strike` how far the beams have reached. Where each source and
 * target stands is fixed when the flare is created, because a creature that
 * died has left the board by the time it plays.
 */
import { Timeline } from "../animation/Timeline.js";
import { Easing } from "../animation/Tween.js";
import { withSeek } from "./TargetRoulette.js";

/**
 * @typedef {import("@magic8/engine/domain/game/GameSnapshot.js").CardView} CardView
 * @typedef {import("./CastReveal.js").CastTarget} CastTarget
 * @typedef {Readonly<{ card: CardView, origin: Readonly<{ x: number, y: number }>, targets: readonly CastTarget[], roulette?: import("./TargetRoulette.js").TargetRoulette | null }>} FlareSource
 *   `roulette`: the crosshair of a random discard, drawing the cards before the beams strike
 * @typedef {{ alpha: number, glow: number, ring: number, seek: number, strike: number }} FlareFrame
 */

/** How long the rune takes to spread, and how long the struck beams are held, as multiples of the long duration. */
const RING_LONG = 0.6;
const HOLD_LONG = 0.8;

export class TriggerFlare {
  /** @type {readonly FlareSource[]} */
  #sources;
  /** @type {Timeline<FlareFrame>} */
  #timeline;
  #started = false;

  /**
   * @param {{ sources: readonly FlareSource[], animation: Readonly<Record<string, number>> }} options
   */
  constructor({ sources, animation }) {
    this.#sources = sources;
    const lit = { alpha: 1, glow: 1, ring: 0, seek: 0, strike: 0 };
    const spread = { ...lit, ring: 1 };
    const sought = { ...spread, seek: 1 };
    const struck = { ...sought, strike: 1 };
    // Sources announced together share one timeline: the longest draw sets the pace, the others finish early and wait.
    const slowest = sources.map((source) => source.roulette ?? null).reduce((longest, roulette) => (roulette !== null && roulette.durationMs > (longest?.durationMs ?? 0) ? roulette : longest), null);
    this.#timeline = new Timeline({
      from: { alpha: 0, glow: 0, ring: 0, seek: 0, strike: 0 },
      stages: [
        { to: lit, durationMs: animation.mediumMs, easing: Easing.easeOutCubic },
        { to: spread, durationMs: animation.longMs * RING_LONG, easing: Easing.easeOutCubic },
        ...withSeek(sought, slowest),
        { to: struck, durationMs: animation.mediumMs, easing: Easing.easeOutCubic },
        { to: struck, durationMs: animation.longMs * HOLD_LONG, easing: Easing.linear },
        { to: { ...struck, alpha: 0, glow: 0 }, durationMs: animation.mediumMs, easing: Easing.easeInCubic },
      ],
    });
  }

  /** @returns {readonly FlareSource[]} the cards whose abilities go off, and what each is aimed at */
  get sources() {
    return this.#sources;
  }

  /** How long the crosshairs have been drawing, in ms: what each source's roulette is read at. */
  get seekMs() {
    const longest = Math.max(0, ...this.#sources.map((source) => source.roulette?.durationMs ?? 0));
    return this.frame.seek * longest;
  }

  /** @returns {FlareFrame} */
  get frame() {
    return this.#timeline.frame;
  }

  /** Whether it has begun to play: until then it waits for the board to settle. */
  get hasStarted() {
    return this.#started;
  }

  /** Whether the beams have reached their targets, so what the abilities did can be shown. */
  get hasStruck() {
    return this.frame.strike >= 1 || this.isDone;
  }

  get isDone() {
    return this.#timeline.isDone;
  }

  /**
   * @param {number} dtMs
   * @returns {boolean} whether the drawn state changed
   */
  update(dtMs) {
    this.#started = true;
    return this.#timeline.update(dtMs);
  }
}
