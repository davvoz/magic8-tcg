/**
 * The gold figures on the painted menu backdrop's rim shining with their own
 * light: each at its own pace, now and then, swells with a soft glow — its
 * gold brightening, the dark around it untouched — while the star at its
 * heart flares, its eight rays reaching a little past the painted ones, then
 * settles back. Slow and quiet, never all together.
 *
 * Presentation state only: time is fed in by the game loop (`update`), and
 * the pauses come from the seed. Frames are asked for only while a figure
 * shines on a screen that shows it, and at most every `frameMs`: the swell
 * is slow, so a lower rate looks the same and costs less.
 */
import { withAlpha } from "../theme/color.js";
import { glint, onPainting, randomStream } from "./backdropLight.js";
import { radialGradient } from "./drawing.js";

/**
 * @typedef {import("./backdropLight.js").Painting} Painting
 * @typedef {import("./backdropLight.js").BackdropLight} BackdropLight
 * @typedef {import("./backdropLight.js").Point} Point
 * @typedef {Readonly<{ x: number, y: number, radius: number }>} GlimmerFigure a gold figure that
 *   shines on its own: the star at its heart, as fractions of the painting, and how far its glow
 *   reaches, as a fraction of the painting's width
 * @typedef {Readonly<{ pauseMs: Readonly<{ min: number, max: number }>, swellMs: number, frameMs: number }>} GlimmerTiming
 *   `pauseMs`: between one figure's swells; `swellMs`: how long one lasts; `frameMs`: the least
 *   time between the frames it asks for
 */

/** @type {GlimmerTiming} */
export const GLIMMER_TIMING = Object.freeze({ pauseMs: Object.freeze({ min: 1500, max: 5000 }), swellMs: 1200, frameMs: 33 });

/** Opacity at the top of a swell: the painting's gold laid over itself, the star's rays and its core. */
const ALPHA = Object.freeze({ glow: 0.4, flare: 0.8, core: 0.35 });
/** The glow fades out from the star in this many steps. */
const GLOW_STEPS = 6;
/**
 * The star's flare, in fractions of the painting's width: how far its four
 * long rays reach at the top of a swell (the diagonal ones reach `diagonal`
 * of that), how thick they are, and how wide its core is (in ray lengths).
 */
const FLARE = Object.freeze({ length: 0.04, width: 0.0016, diagonal: 0.55, core: 0.3 });
const RAYS = 8;

/** @implements {BackdropLight} */
export class Glimmer {
  #figures;
  #timing;
  #random;
  /** Each figure's light: how long until it next swells, or how far into its swell it is. @type {{ waitMs: number, elapsedMs: number | null }[]} */
  #lights;
  /** Whether the last frame drawn showed it. */
  #shown = false;
  #sinceFrameMs = 0;

  /**
   * @param {{ figures: readonly GlimmerFigure[], seed?: string, timing?: GlimmerTiming }} options
   */
  constructor({ figures, seed = "glimmer", timing = GLIMMER_TIMING }) {
    this.#figures = figures;
    this.#timing = timing;
    this.#random = randomStream(seed);
    // Staggered from the start, so they never wake together.
    this.#lights = figures.map(() => ({ waitMs: this.#random() * timing.pauseMs.max, elapsedMs: null }));
  }

  /** How many figures are shining now. */
  get shining() {
    return this.#lights.filter((light) => light.elapsedMs !== null).length;
  }

  /**
   * @param {number} dtMs
   * @returns {boolean} whether a frame is needed: a figure's light moved (or went out) on a screen that shows it
   */
  update(dtMs) {
    let moved = false;
    let ended = false;
    for (const light of this.#lights) {
      if (light.elapsedMs === null) {
        light.waitMs -= dtMs;
        if (light.waitMs <= 0) {
          light.elapsedMs = 0;
          moved = true;
        }
        continue;
      }
      light.elapsedMs += dtMs;
      moved = true;
      if (light.elapsedMs >= this.#timing.swellMs) {
        light.elapsedMs = null;
        light.waitMs = this.#timing.pauseMs.min + this.#random() * (this.#timing.pauseMs.max - this.#timing.pauseMs.min);
        ended = true;
      }
    }
    if (!moved) {
      return false;
    }
    this.#sinceFrameMs += dtMs;
    // A light going out is always drawn, so none is left lit.
    if (this.#sinceFrameMs < this.#timing.frameMs && !ended) {
      return false;
    }
    this.#sinceFrameMs = 0;
    // Drawing it again marks it shown again; a screen that stopped drawing it stops being asked for frames.
    const wanted = this.#shown;
    this.#shown = false;
    return wanted;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {Readonly<Record<string, string>>} colors the theme's colours
   * @param {Painting} painting
   */
  draw(context, colors, painting) {
    this.#shown = true;
    if (this.shining === 0) {
      return;
    }
    const unit = painting.width;
    context.save();
    context.globalCompositeOperation = "lighter";
    this.#lights.forEach((light, index) => {
      if (light.elapsedMs === null) {
        return;
      }
      // Rising and settling gently; the star flares only near the top.
      const swell = Math.sin((Math.PI * light.elapsedMs) / this.#timing.swellMs) ** 2;
      const figure = this.#figures[index];
      const star = onPainting(painting, figure);
      if (painting.image !== undefined) {
        glint(context, painting.image, painting, { center: star, radius: figure.radius * unit, alpha: ALPHA.glow * swell, steps: GLOW_STEPS });
      }
      drawFlare(context, colors, star, { length: FLARE.length * unit * (0.6 + 0.4 * swell), width: FLARE.width * unit, strength: swell ** 3 });
    });
    context.restore();
  }
}

/**
 * Eight thin rays fading out from a bright core, like the painted stars
 * (also the sparks winking on the menu's title).
 * @param {CanvasRenderingContext2D} context
 * @param {Readonly<Record<string, string>>} colors
 * @param {Point} center
 * @param {{ length: number, width: number, strength: number }} flare `strength`: 0..1
 */
export function drawFlare(context, colors, center, { length, width, strength }) {
  context.lineCap = "round";
  context.lineWidth = width;
  for (let ray = 0; ray < RAYS; ray += 1) {
    const angle = (ray * Math.PI * 2) / RAYS;
    const reach = ray % 2 === 0 ? length : length * FLARE.diagonal;
    const tip = { x: center.x + Math.cos(angle) * reach, y: center.y + Math.sin(angle) * reach };
    const gradient = context.createLinearGradient(center.x, center.y, tip.x, tip.y);
    gradient.addColorStop(0, withAlpha(colors.accentLight, ALPHA.flare * strength));
    gradient.addColorStop(1, withAlpha(colors.accentLight, 0));
    context.strokeStyle = gradient;
    context.beginPath();
    context.moveTo(center.x, center.y);
    context.lineTo(tip.x, tip.y);
    context.stroke();
  }
  const core = length * FLARE.core;
  context.fillStyle = radialGradient(context, center, core, [
    [0, withAlpha(colors.text, ALPHA.core * strength)],
    [1, withAlpha(colors.text, 0)],
  ]);
  context.fillRect(center.x - core, center.y - core, core * 2, core * 2);
}
