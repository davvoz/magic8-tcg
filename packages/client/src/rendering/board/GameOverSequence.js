/**
 * The end of a match, played out before the result is offered: the fallen
 * player's life crystal cracks while the table shakes, then bursts into
 * shards with a flash; the table darkens and the outcome comes down over it —
 * rising in gold under turning rays for a victory, dropping like a weight
 * for a defeat. A match lost by concession has no crystal to break: only the
 * darkening and the outcome are played.
 *
 * Presentation state only, fed by the loop, with no drawing of its own. It
 * runs on elapsed time rather than on tweens, because its shards and rays
 * move continuously; every value the painter reads is worked out from that
 * one clock. The shards scatter the same way every time: their spread is
 * fixed by their index, not drawn at random.
 */
import { Easing } from "../animation/Tween.js";

/** @enum {string} */
export const GameOverMood = Object.freeze({
  TRIUMPH: "triumph",
  DEFEAT: "defeat",
  NEUTRAL: "neutral",
});

/**
 * When each part plays, as multiples of the long duration: the crack runs
 * up to the burst; the shards, the flash and the darkening start with it;
 * the outcome comes in later, holds, then fades as the result is offered.
 */
const PHASE = Object.freeze({ crack: 0.9, shards: 2.4, flash: 0.6, dim: 1.6, titleFrom: 2.2, title: 1.2, fadeFrom: 6.2, fade: 0.6 });
/** The shaking of the table, in pixels: building through the crack, a jolt at the burst, a thud as a defeat lands; each jolt dies away over `decay` long durations. */
const SHAKE = Object.freeze({ crack: 5, burst: 14, thud: 10, decay: 0.7, xRate: 0.11, yRate: 0.083, yShare: 0.7 });
/** The shards of a burst crystal: how many, how fast (px/ms), how big, how they spin (rad/ms) and fall (px/ms²). */
const SHARD = Object.freeze({ count: 28, speedMin: 0.18, speedSpread: 0.34, sizeMin: 4, sizeSpread: 8, spin: 0.02, gravity: 0.00045 });
/** How fast the rays behind a victory turn, in radians per millisecond. */
const RAY_SPIN = 0.00018;

/**
 * @typedef {Readonly<{ x: number, y: number, radius: number }>} Crystal
 * @typedef {Readonly<{ x: number, y: number, size: number, rotation: number, alpha: number }>} Shard
 */

export class GameOverSequence {
  #mood;
  #title;
  #subtitle;
  /** @type {readonly Crystal[]} */
  #crystals;
  #longMs;
  #elapsedMs = 0;

  /**
   * @param {{ mood: string, title: string, subtitle: string, crystals: readonly Crystal[], animation: Readonly<Record<string, number>> }} options
   *   `crystals`: the life crystals of the players who fell (none when the match was conceded)
   */
  constructor({ mood, title, subtitle, crystals, animation }) {
    this.#mood = mood;
    this.#title = title;
    this.#subtitle = subtitle;
    this.#crystals = crystals;
    this.#longMs = animation.longMs;
  }

  get mood() {
    return this.#mood;
  }

  get title() {
    return this.#title;
  }

  get subtitle() {
    return this.#subtitle;
  }

  /** @returns {readonly Crystal[]} */
  get crystals() {
    return this.#crystals;
  }

  get isDone() {
    return this.#elapsedMs >= this.#ms(PHASE.fadeFrom + PHASE.fade);
  }

  /** How long the cracks take to run through a crystal, up to the burst. */
  get crackMs() {
    return this.#ms(PHASE.crack);
  }

  /**
   * @param {number} dtMs
   * @returns {boolean} whether a render is needed — every frame while it plays, the last one included
   */
  update(dtMs) {
    if (this.isDone) {
      return false;
    }
    this.#elapsedMs += Math.max(0, dtMs);
    return true;
  }

  /** @returns {number} 0 → 1 as the cracks run through the crystal, up to the burst */
  get crack() {
    return Easing.easeInCubic(this.#phase(0, PHASE.crack));
  }

  /** Whether the crystals have burst. */
  get burst() {
    return this.#sinceBurst >= 0;
  }

  /** @returns {number} 1 at the burst, gone soon after */
  get flash() {
    return this.burst && this.#crystals.length > 0 ? 1 - this.#phase(PHASE.crack, PHASE.flash) : 0;
  }

  /** @returns {number} 0 → 1 as the table darkens */
  get dim() {
    return Easing.easeOutCubic(this.#phase(PHASE.crack, PHASE.dim));
  }

  /** @returns {number} 0 → 1 as the outcome comes in, running a touch past 1 as it lands */
  get titleIn() {
    return Easing.easeOutBack(this.#phase(PHASE.titleFrom, PHASE.title));
  }

  /** @returns {number} how visible the outcome is: in quickly, out as the result is offered */
  get titleAlpha() {
    return this.#phase(PHASE.titleFrom, PHASE.title / 2) * (1 - this.#phase(PHASE.fadeFrom, PHASE.fade));
  }

  /** @returns {number} the angle of the rays behind a victory */
  get raysAngle() {
    return this.#elapsedMs * RAY_SPIN;
  }

  /** @returns {{ x: number, y: number }} how far the whole table is thrown right now */
  get shake() {
    const amplitude = this.#crystals.length > 0 ? this.#crackShake() + this.#jolt(this.#sinceBurst, SHAKE.burst) : 0;
    const thud = this.#mood === GameOverMood.DEFEAT ? this.#jolt(this.#elapsedMs - this.#ms(PHASE.titleFrom + PHASE.title / 2), SHAKE.thud) : 0;
    const total = amplitude + thud;
    if (total === 0) {
      return { x: 0, y: 0 };
    }
    return { x: Math.sin(this.#elapsedMs * SHAKE.xRate) * total, y: Math.cos(this.#elapsedMs * SHAKE.yRate) * total * SHAKE.yShare };
  }

  /** @returns {readonly Shard[]} the flying pieces of every burst crystal; none before the burst or once they have fallen */
  get shards() {
    const lifeMs = this.#ms(PHASE.shards);
    const since = this.#sinceBurst;
    if (since < 0 || since >= lifeMs) {
      return [];
    }
    const through = since / lifeMs;
    return this.#crystals.flatMap((crystal, which) =>
      Array.from({ length: SHARD.count }, (_, index) => {
        const salt = which * SHARD.count + index;
        const angle = (index / SHARD.count) * Math.PI * 2 + (spread(salt, 1) - 0.5) * 0.6;
        const speed = SHARD.speedMin + SHARD.speedSpread * spread(salt, 2);
        const distance = speed * lifeMs * 0.5 * Easing.easeOutCubic(through);
        return Object.freeze({
          x: crystal.x + Math.cos(angle) * distance,
          y: crystal.y + Math.sin(angle) * distance + SHARD.gravity * since * since,
          size: SHARD.sizeMin + SHARD.sizeSpread * spread(salt, 3),
          rotation: (spread(salt, 4) - 0.5) * SHARD.spin * since,
          alpha: 1 - through,
        });
      }),
    );
  }

  get #sinceBurst() {
    return this.#elapsedMs - this.#ms(PHASE.crack);
  }

  #crackShake() {
    return this.burst ? 0 : SHAKE.crack * this.crack;
  }

  /**
   * A jolt of `size` pixels `sinceMs` ago, dying away.
   * @param {number} sinceMs
   * @param {number} size
   */
  #jolt(sinceMs, size) {
    const decayMs = this.#ms(SHAKE.decay);
    return sinceMs < 0 || sinceMs >= decayMs ? 0 : size * (1 - sinceMs / decayMs) ** 2;
  }

  /**
   * How far through a part the sequence is, clamped to 0–1.
   * @param {number} from start, in long durations
   * @param {number} length in long durations
   */
  #phase(from, length) {
    const lengthMs = this.#ms(length);
    return lengthMs <= 0 ? 1 : Math.min(1, Math.max(0, (this.#elapsedMs - this.#ms(from)) / lengthMs));
  }

  /** @param {number} longs */
  #ms(longs) {
    return longs * this.#longMs;
  }
}

/**
 * A fixed value in [0, 1) for the `salt`-th shard's `field`: the scatter looks random but is the same every time.
 * @param {number} salt
 * @param {number} field
 */
function spread(salt, field) {
  const value = Math.sin(salt * 12.9898 + field * 78.233) * 43758.5453;
  return value - Math.floor(value);
}
