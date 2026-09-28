/**
 * The animation of a spell the opponent cast. Such a card never reaches the
 * board — it goes from a hidden hand straight to the graveyard — so it is
 * given the gesture it deserves: the face-down card rises out of their hand,
 * turns over the middle of the table, throws its rune, strikes whatever it
 * was aimed at, holds still long enough to be read, then sinks into their
 * graveyard.
 *
 * Presentation state only, like CardVisual: a chain of Tweens over one
 * record, fed by the loop, with no drawing and no clock of its own. The
 * painter reads `frame`, where `turn` carries the flip (0 face-down, 1
 * face-up), `glow` the light the cast throws on the table, `ring` the rune
 * spreading out of it and `strike` how far its beams have reached their
 * targets. Those targets are fixed when the cast is created, because a
 * creature it kills has left the board by the time the card is held up.
 */
import { Timeline } from "../animation/Timeline.js";
import { Easing } from "../animation/Tween.js";

/**
 * @typedef {import("@magic8/engine/shared/geometry.js").Rect} Rect
 * @typedef {import("@magic8/engine/domain/game/GameSnapshot.js").CardView} CardView
 * @typedef {Readonly<{ x: number, y: number, name: string }>} CastTarget
 * @typedef {{ x: number, y: number, width: number, height: number, alpha: number, turn: number, glow: number, ring: number, strike: number }} RevealFrame
 */

/** How long the rune takes to spread, as a multiple of the long duration. */
const BURST_MULTIPLIER = 0.7;
/** Size the card shrinks to as it sinks into the graveyard, relative to the held size. */
const SINK_SCALE = 0.3;
/** Light on the table while the card is still on its way up. */
const RISING_GLOW = 0.45;

export class CastReveal {
  /** @type {CardView} */
  #card;
  #caption;
  /** @type {readonly CastTarget[]} */
  #targets;
  /** Centre of the held card: where the beams start, and where they stay once it sinks. */
  #origin;
  /** @type {Timeline<RevealFrame>} */
  #timeline;

  /**
   * @param {{ card: CardView, caption: string, targets: readonly CastTarget[], from: Rect, at: Rect, to: Rect, animation: Readonly<Record<string, number>>, holdMs: number }} options
   *   `from` is the opponent's hand, `at` where the card is held up, `to` their
   *   graveyard; `holdMs` is how long it stays face-up and still, which the
   *   caller shortens when another cast is already waiting behind this one
   */
  constructor({ card, caption, targets, from, at, to, animation, holdMs }) {
    this.#card = card;
    this.#caption = caption;
    this.#targets = targets;
    this.#origin = Object.freeze({ x: at.x + at.width / 2, y: at.y + at.height / 2 });
    const held = { ...at, alpha: 1, turn: 0, glow: RISING_GLOW, ring: 0, strike: 0 };
    const faceUp = { ...held, turn: 1, glow: 1 };
    const burst = { ...faceUp, ring: 1 };
    const struck = { ...burst, strike: 1 };
    this.#timeline = new Timeline({
      from: { ...from, alpha: 0.9, turn: 0, glow: 0, ring: 0, strike: 0 },
      stages: [
        { to: held, durationMs: animation.mediumMs, easing: Easing.easeOutCubic },
        { to: faceUp, durationMs: animation.mediumMs, easing: Easing.easeInOutQuad },
        { to: burst, durationMs: animation.longMs * BURST_MULTIPLIER, easing: Easing.easeOutCubic },
        { to: struck, durationMs: animation.mediumMs, easing: Easing.easeOutCubic },
        { to: struck, durationMs: holdMs, easing: Easing.linear },
        { to: { ...shrunkOnto(struck, to, SINK_SCALE), alpha: 0, glow: 0 }, durationMs: animation.longMs, easing: Easing.easeInOutQuad },
      ],
    });
  }

  /** @returns {CardView} */
  get card() {
    return this.#card;
  }

  get caption() {
    return this.#caption;
  }

  /** @returns {readonly CastTarget[]} what the spell was aimed at, where they stood */
  get targets() {
    return this.#targets;
  }

  /** @returns {{ x: number, y: number }} */
  get origin() {
    return this.#origin;
  }

  /** @returns {RevealFrame} where and how the card is drawn right now */
  get frame() {
    return this.#timeline.frame;
  }

  get isDone() {
    return this.#timeline.isDone;
  }

  /**
   * @param {number} dtMs
   * @returns {boolean} whether the drawn state changed — false through the
   *   hold, where nothing moves and the frame need not be redrawn
   */
  update(dtMs) {
    return this.#timeline.update(dtMs);
  }
}

/**
 * `frame` scaled down around the centre of `target`: where the card ends up
 * when it is drawn into the graveyard.
 * @param {RevealFrame} frame
 * @param {Rect} target
 * @param {number} scale
 * @returns {RevealFrame}
 */
function shrunkOnto(frame, target, scale) {
  const width = frame.width * scale;
  const height = frame.height * scale;
  return { ...frame, x: target.x + (target.width - width) / 2, y: target.y + (target.height - height) / 2, width, height };
}
