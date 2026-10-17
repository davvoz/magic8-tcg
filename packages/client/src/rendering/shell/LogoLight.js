/**
 * The light that lives in the game's logo, as it lived in the old title: now
 * and then a sheen sweeps across the gold, sparks wink on the letters'
 * tops, and the compass star flares up and settles back. The shell keeps
 * one per screen and feeds it time (`update`); the logo (GameLogo) paints
 * it over the painted name (`paint`), where the art's layout says the
 * letters and the star are (UiArtLayout.title). Presentation state only:
 * the pauses come from the seed; frames are asked for only while something
 * moves, at most every `frameMs`.
 */
import { withAlpha, mix } from "../theme/color.js";
import { drawFlare } from "../ui/Glimmer.js";
import { randomStream } from "../ui/backdropLight.js";
import { radialGradient } from "../ui/drawing.js";

/**
 * @typedef {Readonly<{ min: number, max: number }>} Span
 * @typedef {Readonly<{ firstMs: Span, pauseMs: Span, durationMs: number }>} BeatTiming when it first comes, the pause
 *   between two, and how long one lasts
 */

/** When each light comes and how long it lasts, and the least time between two frames. */
export const LOGO_TIMING = Object.freeze({
  sweep: Object.freeze({ firstMs: Object.freeze({ min: 1500, max: 3000 }), pauseMs: Object.freeze({ min: 7000, max: 12000 }), durationMs: 1800 }),
  spark: Object.freeze({ firstMs: Object.freeze({ min: 2000, max: 4000 }), pauseMs: Object.freeze({ min: 1500, max: 4000 }), durationMs: 900 }),
  star: Object.freeze({ firstMs: Object.freeze({ min: 3000, max: 5000 }), pauseMs: Object.freeze({ min: 6000, max: 10000 }), durationMs: 2600 }),
  frameMs: 33,
});
/** The sheen: its half-width and lean in letter heights, and the gold laid again in bands narrowing to its core (half-width in sheen widths, strength). */
const SHEEN = Object.freeze({ halfWidth: 0.6, tilt: 0.25, bands: Object.freeze([Object.freeze([0.55, 0.16]), Object.freeze([0.3, 0.2]), Object.freeze([0.12, 0.3])]) });
/** The star flaring up: its halo's reach and strength, its rays' length and width (in letter heights), the light at its heart. */
const STAR = Object.freeze({ halo: 0.9, haloAlpha: 0.55, length: 0.75, width: 0.03, heart: 0.3, heartAlpha: 0.75 });
/** A spark's rays, in letter heights. */
const SPARK = Object.freeze({ length: 0.4, width: 0.018 });
/** Sparks that may wink at once. */
const SPARKS = 2;

/** Something that comes now and then, lasts a while, and goes. */
class Beat {
  #timing;
  #random;
  waitMs;
  /** How far into it, or null between two. @type {number | null} */
  elapsedMs = null;

  /**
   * @param {BeatTiming} timing
   * @param {() => number} random
   */
  constructor(timing, random) {
    this.#timing = timing;
    this.#random = random;
    this.waitMs = between(timing.firstMs, random);
  }

  /** 0..1 through it, or null between two. */
  get progress() {
    return this.elapsedMs === null ? null : Math.min(1, this.elapsedMs / this.#timing.durationMs);
  }

  /** Rising and settling gently: 0 at either end, 1 halfway. */
  get swell() {
    const progress = this.progress;
    return progress === null ? 0 : Math.sin(Math.PI * progress) ** 2;
  }

  /**
   * @param {number} dtMs
   * @returns {"idle" | "started" | "moving" | "ended"}
   */
  advance(dtMs) {
    if (this.elapsedMs === null) {
      this.waitMs -= dtMs;
      if (this.waitMs > 0) {
        return "idle";
      }
      this.elapsedMs = 0;
      return "started";
    }
    this.elapsedMs += dtMs;
    if (this.elapsedMs < this.#timing.durationMs) {
      return "moving";
    }
    this.elapsedMs = null;
    this.waitMs = between(this.#timing.pauseMs, this.#random);
    return "ended";
  }
}

export class LogoLight {
  #timing;
  #random;
  #sweep;
  #star;
  /** Each spark's pace, and where it winks: which letter, and how far across it. */
  #sparks;
  #sinceFrameMs = 0;

  /** @param {{ seed?: string, timing?: typeof LOGO_TIMING }} [options] */
  constructor({ seed = "logo", timing = LOGO_TIMING } = {}) {
    this.#timing = timing;
    this.#random = randomStream(seed);
    this.#sweep = new Beat(timing.sweep, this.#random);
    this.#star = new Beat(timing.star, this.#random);
    this.#sparks = Array.from({ length: SPARKS }, () => ({ beat: new Beat(timing.spark, this.#random), letter: 0, across: 0.5 }));
  }

  /** Whether a sheen is crossing the gold, the star flares or a spark winks now. */
  get lit() {
    return this.#sweep.progress !== null || this.#star.progress !== null || this.#sparks.some((spark) => spark.beat.progress !== null);
  }

  /**
   * @param {number} dtMs
   * @returns {boolean} whether a frame is needed: a light moved (or went out)
   */
  update(dtMs) {
    let moved = false;
    let ended = false;
    for (const beat of [this.#sweep, this.#star]) {
      const step = beat.advance(dtMs);
      moved ||= step !== "idle";
      ended ||= step === "ended";
    }
    for (const spark of this.#sparks) {
      const step = spark.beat.advance(dtMs);
      if (step === "started") {
        spark.letter = this.#random();
        spark.across = this.#random();
      }
      moved ||= step !== "idle";
      ended ||= step === "ended";
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
    return true;
  }

  /**
   * The light over the painted name drawn in `box`.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {{ image: import("../images/ImageCache.js").LoadedImage, box: import("@magic8/engine/shared/geometry.js").Rect, letters: import("../images/UiArt.js").TitleLayout }} name
   */
  paint(context, theme, { image, box, letters }) {
    const crest = crestOf(box, letters);
    context.save();
    this.#paintSheen(context, image, box, crest);
    this.#paintStar(context, theme.colors, crest);
    this.#paintSparks(context, theme.colors, crest);
    context.restore();
  }

  /**
   * The sheen: the image laid again, lighter, within leaning bands that narrow to its core.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../images/ImageCache.js").LoadedImage} image
   * @param {import("@magic8/engine/shared/geometry.js").Rect} box
   * @param {Crest} crest
   */
  #paintSheen(context, image, box, { left, width, cap }) {
    const progress = this.#sweep.progress;
    if (progress === null) {
      return;
    }
    const half = SHEEN.halfWidth * cap;
    const lean = SHEEN.tilt * cap;
    const eased = progress * progress * (3 - 2 * progress);
    const x = left - half - lean + eased * (width + 2 * (half + lean));
    const strength = Math.sin(Math.PI * progress);
    for (const [reach, alpha] of SHEEN.bands) {
      const band = half * reach;
      context.save();
      context.beginPath();
      context.moveTo(x - band, box.y);
      context.lineTo(x + band, box.y);
      context.lineTo(x + band + lean, box.y + box.height);
      context.lineTo(x - band + lean, box.y + box.height);
      context.closePath();
      context.clip();
      context.globalCompositeOperation = "lighter";
      context.globalAlpha = alpha * strength;
      context.drawImage(image.source, box.x, box.y, box.width, box.height);
      context.restore();
    }
  }

  /**
   * The star flaring up: a halo, rays and a light at its heart.
   * @param {CanvasRenderingContext2D} context
   * @param {Readonly<Record<string, any>>} colors
   * @param {Crest} crest
   */
  #paintStar(context, colors, { star, cap }) {
    const strength = this.#star.swell;
    if (strength <= 0) {
      return;
    }
    const glow = mix(colors.accentLight, "#ffffff", 0.45);
    context.save();
    context.globalCompositeOperation = "lighter";
    const reach = cap * STAR.halo;
    context.fillStyle = radialGradient(context, star, reach, [[0, withAlpha(glow, STAR.haloAlpha * strength)], [0.45, withAlpha(colors.accent, 0.3 * STAR.haloAlpha * strength)], [1, withAlpha(colors.accent, 0)]]);
    context.fillRect(star.x - reach, star.y - reach, reach * 2, reach * 2);
    const heart = cap * STAR.heart;
    context.fillStyle = radialGradient(context, star, heart, [[0, withAlpha(glow, STAR.heartAlpha * strength)], [1, withAlpha(glow, 0)]]);
    context.fillRect(star.x - heart, star.y - heart, heart * 2, heart * 2);
    drawFlare(context, colors, star, { length: STAR.length * cap * (0.6 + 0.4 * strength), width: Math.max(1, STAR.width * cap), strength });
    context.restore();
  }

  /**
   * Sparks winking on the letters' tops, where the light catches the serifs.
   * @param {CanvasRenderingContext2D} context
   * @param {Readonly<Record<string, any>>} colors
   * @param {Crest} crest
   */
  #paintSparks(context, colors, { stops, top, cap }) {
    const lit = this.#sparks.filter((spark) => spark.beat.progress !== null);
    if (lit.length === 0) {
      return;
    }
    context.save();
    context.globalCompositeOperation = "lighter";
    for (const spark of lit) {
      const letter = Math.min(stops.length - 2, Math.floor(spark.letter * (stops.length - 1)));
      const from = stops[letter];
      const to = stops[letter + 1];
      const point = { x: from + (to - from) * (0.15 + 0.7 * spark.across), y: top + cap * 0.04 };
      const swell = spark.beat.swell;
      drawFlare(context, colors, point, { length: SPARK.length * cap * (0.5 + 0.5 * swell), width: Math.max(1, SPARK.width * cap), strength: swell });
    }
    context.restore();
  }
}

/**
 * @typedef {Readonly<{ left: number, width: number, top: number, cap: number, stops: readonly number[], star: { x: number, y: number } }>} Crest
 *   where the letters are (their left end, width, top and height), where each starts (then where the last ends), and the star
 */

/**
 * @param {import("@magic8/engine/shared/geometry.js").Rect} box
 * @param {import("../images/UiArt.js").TitleLayout} letters
 * @returns {Crest}
 */
function crestOf(box, letters) {
  const first = letters.stops[0];
  const last = letters.stops[letters.stops.length - 1];
  return {
    left: box.x + box.width * first,
    width: box.width * (last - first),
    top: box.y + box.height * letters.top,
    cap: box.height * (letters.bottom - letters.top),
    stops: letters.stops.map((stop) => box.x + box.width * stop),
    star: { x: box.x + box.width * letters.star.x, y: box.y + box.height * letters.star.y },
  };
}

/**
 * @param {Span} span
 * @param {() => number} random
 */
function between({ min, max }, random) {
  return min + random() * (max - min);
}
