/**
 * The game's name over the main menu's fan, as a crest of old cast gold: the
 * letters in the title face (Theme.fonts.titleFamily), carved deep over a
 * dark shadow, polished like metal but rusted and worn in patches, with a
 * chipped bright edge, and a gold rule
 * reaching out on either side from a diamond. It lives: now and then a
 * sheen of light sweeps across the gold (the first one soon after the menu
 * opens), sparks wink on the letters' edges, and the letter at its end
 * kindles with an arcane glow and settles back.
 *
 * Presentation state only, like the backdrop's lights: time is fed in by
 * the scene (`update`) and the pauses come from the seed. Frames are asked
 * for only while something moves on a screen that draws it, and at most
 * every `frameMs`. Decorative and non-interactive.
 */
import { withAlpha, mix, shade } from "../../theme/color.js";
import { drawFlare } from "../../ui/Glimmer.js";
import { randomStream } from "../../ui/backdropLight.js";
import { radialGradient } from "../../ui/drawing.js";
import { polygonPath } from "../../ui/shapes.js";
import { UiNode } from "../../ui/UiNode.js";
import { rustPattern } from "./rustTexture.js";

/**
 * @typedef {Readonly<{ min: number, max: number }>} Span
 * @typedef {Readonly<{ firstMs: Span, pauseMs: Span, durationMs: number }>} BeatTiming when it first
 *   comes, the pause between two, and how long one lasts
 * @typedef {Readonly<{ sweep: BeatTiming, spark: BeatTiming, kindle: BeatTiming, frameMs: number }>} TitleTiming
 */

/** @type {TitleTiming} */
export const TITLE_TIMING = Object.freeze({
  sweep: Object.freeze({ firstMs: Object.freeze({ min: 600, max: 900 }), pauseMs: Object.freeze({ min: 6000, max: 10000 }), durationMs: 1800 }),
  spark: Object.freeze({ firstMs: Object.freeze({ min: 1200, max: 3000 }), pauseMs: Object.freeze({ min: 700, max: 2600 }), durationMs: 900 }),
  kindle: Object.freeze({ firstMs: Object.freeze({ min: 2500, max: 4000 }), pauseMs: Object.freeze({ min: 5000, max: 9000 }), durationMs: 2600 }),
  frameMs: 33,
});

/** Sparks that may wink at once (each keeps its own pace). */
const SPARKS = 2;
/** The letters' size: a share of the node's height, unless the width (with the rules) is shorter. */
const SIZE = Object.freeze({ ofHeight: 0.8, reference: 100 });
/** Capital height in ems, when the browser cannot measure it. */
const CAP_HEIGHT = 0.7;
/** The carved depth, in ems: layers stacked below the face, darkening as they go. */
const DEPTH = Object.freeze({ layers: 4, step: 0.014 });
/** The shadow the crest casts on the backdrop, the dark outline and the bright bevel, in ems. */
const SHADOW = Object.freeze({ blur: 0.22, drop: 0.07 });
const OUTLINE = 0.075;
const BEVEL = 0.016;
/** The bright edge is chipped: this many lit and broken stretches along it, up to `longest` pixels each. */
const CHIPS = Object.freeze({ count: 24, longest: 26 });
/**
 * The rules on either side, in ems: the gap left at the word, the longest
 * and shortest they may be (shorter than `min`, there are none), their
 * thickness, and the diamond at their inner end.
 */
const WING = Object.freeze({ gap: 0.24, max: 1.5, min: 0.5, width: 0.024, diamond: 0.075 });
/** The sheen's half-width, in ems, its tilt (how far it leans across the letters' height), and its strength at its core and in the soft light around it. */
const SHEEN = Object.freeze({ halfWidth: 0.9, tilt: 0.35, core: 0.95, soft: 0.3 });
/** The glow behind the word: at rest, and how much a sheen or the last letter's kindling adds. */
const AURA = Object.freeze({ rest: 0.14, sweep: 0.12, kindle: 0.12, height: 0.42 });
/** The sparks, in ems: how far their rays reach and how thick they are. */
const SPARK = Object.freeze({ length: 0.42, width: 0.018 });
/** The last letter's kindling, at its top: the halo behind it (reach in capital heights), the light within it and its glowing rim (blur in ems). */
const KINDLE = Object.freeze({ halo: 1.1, haloAlpha: 0.55, within: 0.9, rim: 0.9, blur: 0.12 });

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

export class TitleLogo extends UiNode {
  text;
  #timing;
  #random;
  #sweep;
  #kindle;
  /** Each spark's pace, and where on the letters it winks: a letter, and fractions across and down it. */
  #sparks;
  /** Whether the last frame drawn showed it. */
  #shown = false;
  #sinceFrameMs = 0;
  #seed;
  /** The rust laid over the gold, made once for the context that draws it (null: none can be made). @type {{ context: CanvasRenderingContext2D, pattern: CanvasPattern | null } | null} */
  #rust = null;
  /** Where the bright edge is lit and where it is chipped away (a line dash). @type {number[]} */
  #chips;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, text: string, seed?: string, timing?: TitleTiming }} options
   */
  constructor({ text, seed = "title", timing = TITLE_TIMING, ...area }) {
    super({ id: "title", ...area });
    this.passthrough = true;
    this.text = text;
    this.#timing = timing;
    this.#random = randomStream(seed);
    this.#seed = seed;
    this.#chips = Array.from({ length: CHIPS.count }, (_, index) => 1 + this.#random() * (index % 2 === 0 ? CHIPS.longest : CHIPS.longest / 4));
    this.#sweep = new Beat(timing.sweep, this.#random);
    this.#kindle = new Beat(timing.kindle, this.#random);
    this.#sparks = Array.from({ length: SPARKS }, () => ({ beat: new Beat(timing.spark, this.#random), letter: 0, across: 0.5, edge: 0 }));
  }

  /** Whether a sheen is crossing the gold now. */
  get sweeping() {
    return this.#sweep.progress !== null;
  }

  /** Whether the last letter glows now. */
  get kindled() {
    return this.#kindle.progress !== null;
  }

  /** How many sparks wink now. */
  get sparking() {
    return this.#sparks.filter((spark) => spark.beat.progress !== null).length;
  }

  /**
   * @param {number} dtMs
   * @returns {boolean} whether a frame is needed: its light moved (or went out) on a screen that shows it
   */
  update(dtMs) {
    let moved = false;
    let ended = false;
    for (const beat of [this.#sweep, this.#kindle]) {
      const step = beat.advance(dtMs);
      moved ||= step !== "idle";
      ended ||= step === "ended";
    }
    for (const spark of this.#sparks) {
      const step = spark.beat.advance(dtMs);
      if (step === "started") {
        spark.letter = Math.floor(this.#random() * Math.max(1, this.text.length));
        spark.across = this.#random();
        spark.edge = this.#random();
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
    // Drawing it again marks it shown again; a screen that stopped drawing it stops being asked for frames.
    const wanted = this.#shown;
    this.#shown = false;
    return wanted;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    this.#shown = true;
    const crest = this.#layout(context, theme);
    const { colors } = theme;
    context.save();
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.lineJoin = "round";
    context.font = crest.font;
    this.#paintAura(context, colors, crest);
    this.#paintKindle(context, colors, crest, "halo");
    paintWings(context, colors, crest);
    paintCarving(context, colors, crest, this.text);
    paintGold(context, colors, crest, { text: this.text, rust: this.#rustFor(context), chips: this.#chips });
    this.#paintKindle(context, colors, crest, "within");
    this.#paintSheen(context, crest);
    context.restore();
    this.#paintSparks(context, colors, crest);
  }

  /** @param {CanvasRenderingContext2D} context */
  #rustFor(context) {
    if (this.#rust?.context !== context) {
      this.#rust = { context, pattern: rustPattern(context, `${this.#seed}:rust`) };
    }
    return this.#rust.pattern;
  }

  /**
   * Where the word goes: its size, its left end and baseline, its capitals' top, and its rules.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   * @returns {Crest}
   */
  #layout(context, theme) {
    const area = this.bounds;
    const family = theme.fonts.titleFamily ?? theme.fonts.displayFamily;
    context.font = titleFont(family, SIZE.reference);
    const perEm = Math.max(1, context.measureText(this.text).width) / SIZE.reference;
    const size = Math.max(1, Math.min(area.height * SIZE.ofHeight, area.width / (perEm + 2 * (WING.gap + WING.min))));
    const font = titleFont(family, size);
    context.font = font;
    const metrics = context.measureText(this.text);
    const width = metrics.width;
    const measuredCap = metrics.actualBoundingBoxAscent;
    const cap = typeof measuredCap === "number" && measuredCap > 0 ? measuredCap : CAP_HEIGHT * size;
    const center = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
    const left = center.x - width / 2;
    const baseline = center.y + cap / 2;
    const wing = Math.min(WING.max * size, (area.width - width) / 2 - WING.gap * size);
    // Each letter's span, for the sparks and the last letter's kindling.
    const stops = [...this.text].map((_, index) => left + context.measureText(this.text.slice(0, index)).width);
    return { font, size, width, left, baseline, top: baseline - cap, cap, center, wing: wing >= WING.min * size ? wing : 0, stops: [...stops, left + width] };
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {Readonly<Record<string, string>>} colors
   * @param {Crest} crest
   */
  #paintAura(context, colors, { center, width }) {
    const alpha = AURA.rest + AURA.sweep * this.#sweep.swell + AURA.kindle * this.#kindle.swell;
    const radius = width * 0.62;
    context.save();
    context.translate(center.x, center.y);
    context.scale(1, AURA.height);
    context.fillStyle = radialGradient(context, { x: 0, y: 0 }, radius, [[0, withAlpha(colors.accent, alpha)], [0.55, withAlpha(colors.accent, alpha * 0.35)], [1, withAlpha(colors.accent, 0)]]);
    context.fillRect(-radius, -radius, radius * 2, radius * 2);
    context.restore();
  }

  /**
   * The 8 catching an arcane fire, then settling back to gold: a halo
   * behind it (under the carving), then a light within its gold and a
   * glowing rim (over its face).
   * @param {CanvasRenderingContext2D} context
   * @param {Readonly<Record<string, string>>} colors
   * @param {Crest} crest
   * @param {"halo" | "within"} layer
   */
  #paintKindle(context, colors, crest, layer) {
    const strength = this.#kindle.swell;
    const last = this.text.length - 1;
    if (strength <= 0 || last < 0) {
      return;
    }
    const glow = arcane(colors).light;
    const x = crest.stops[last];
    const middle = { x: (x + crest.stops[last + 1]) / 2, y: crest.top + crest.cap / 2 };
    context.save();
    if (layer === "halo") {
      const reach = crest.cap * KINDLE.halo;
      context.fillStyle = radialGradient(context, middle, reach, [[0, withAlpha(glow, KINDLE.haloAlpha * strength)], [0.5, withAlpha(glow, 0.3 * KINDLE.haloAlpha * strength)], [1, withAlpha(glow, 0)]]);
      context.fillRect(middle.x - reach, middle.y - reach, reach * 2, reach * 2);
    } else {
      const deep = arcane(colors).base;
      context.fillStyle = radialGradient(context, middle, crest.cap * 0.7, [[0, withAlpha(mix(glow, "#ffffff", 0.3), KINDLE.within * strength)], [0.35, withAlpha(glow, KINDLE.within * strength)], [1, withAlpha(deep, 0.85 * KINDLE.within * strength)]]);
      context.fillText(this.text[last], x, crest.baseline);
      context.globalCompositeOperation = "lighter";
      context.shadowColor = withAlpha(glow, strength);
      context.shadowBlur = KINDLE.blur * crest.size * strength;
      context.strokeStyle = withAlpha(glow, KINDLE.rim * strength);
      context.lineWidth = Math.max(1, BEVEL * crest.size);
      context.strokeText(this.text[last], x, crest.baseline);
    }
    context.restore();
  }

  /**
   * A band of light crossing the letters, leaning like a polished edge catching it.
   * @param {CanvasRenderingContext2D} context
   * @param {Crest} crest
   */
  #paintSheen(context, { left, width, top, baseline, size }) {
    const progress = this.#sweep.progress;
    if (progress === null) {
      return;
    }
    const half = SHEEN.halfWidth * size;
    const lean = SHEEN.tilt * size;
    // Eased, so it glides in and out; it starts and ends clear of the word.
    const eased = progress * progress * (3 - 2 * progress);
    const x = left - half - lean + eased * (width + 2 * (half + lean));
    const strength = Math.sin(Math.PI * progress);
    const gradient = context.createLinearGradient(x - half, top, x + half, baseline + lean);
    const light = (alpha) => `rgba(255, 248, 225, ${(alpha * strength).toFixed(3)})`;
    gradient.addColorStop(0, light(0));
    gradient.addColorStop(0.25, light(0));
    gradient.addColorStop(0.44, light(SHEEN.soft));
    gradient.addColorStop(0.5, light(SHEEN.core));
    gradient.addColorStop(0.56, light(SHEEN.soft));
    gradient.addColorStop(0.75, light(0));
    gradient.addColorStop(1, light(0));
    context.globalCompositeOperation = "lighter";
    context.fillStyle = gradient;
    context.fillText(this.text, left, baseline);
    context.globalCompositeOperation = "source-over";
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {Readonly<Record<string, string>>} colors
   * @param {Crest} crest
   */
  #paintSparks(context, colors, crest) {
    const lit = this.#sparks.filter((spark) => spark.beat.progress !== null);
    if (lit.length === 0) {
      return;
    }
    context.save();
    context.globalCompositeOperation = "lighter";
    for (const spark of lit) {
      const letter = Math.min(spark.letter, crest.stops.length - 2);
      const from = crest.stops[letter];
      const to = crest.stops[letter + 1];
      // Mostly on the capitals' top edge, where the light catches the serifs; now and then at their foot.
      const y = spark.edge < 0.7 ? crest.top + crest.cap * 0.06 : crest.baseline - crest.cap * 0.06;
      const point = { x: from + (to - from) * (0.15 + 0.7 * spark.across), y };
      const swell = spark.beat.swell;
      drawFlare(context, colors, point, { length: SPARK.length * crest.size * (0.5 + 0.5 * swell), width: SPARK.width * crest.size, strength: swell });
    }
    context.restore();
  }
}

/**
 * @typedef {Readonly<{
 *   font: string, size: number, width: number, left: number, baseline: number, top: number, cap: number,
 *   center: { x: number, y: number }, wing: number, stops: readonly number[],
 * }>} Crest `stops`: where each letter starts, then where the word ends; `wing`: each rule's length (0: none)
 */

/**
 * The rules reaching out from the word: a gold line fading away from a
 * bright diamond, a thinner one under it, and a bead between.
 * @param {CanvasRenderingContext2D} context
 * @param {Readonly<Record<string, string>>} colors
 * @param {Crest} crest
 */
function paintWings(context, colors, { left, width, top, cap, size, wing }) {
  if (wing <= 0) {
    return;
  }
  const y = top + cap / 2;
  const gap = WING.gap * size;
  for (const side of [-1, 1]) {
    const inner = side < 0 ? left - gap : left + width + gap;
    const outer = inner + side * wing;
    const gradient = context.createLinearGradient(inner, y, outer, y);
    gradient.addColorStop(0, withAlpha(colors.accentLight, 0.95));
    gradient.addColorStop(0.35, withAlpha(colors.accent, 0.8));
    gradient.addColorStop(1, withAlpha(colors.accent, 0));
    context.strokeStyle = gradient;
    context.lineCap = "round";
    context.lineWidth = Math.max(1, WING.width * size);
    context.beginPath();
    context.moveTo(inner, y);
    context.lineTo(outer, y);
    context.stroke();
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(inner + side * size * 0.12, y + size * 0.075);
    context.lineTo(inner + side * wing * 0.6, y + size * 0.075);
    context.moveTo(inner + side * size * 0.12, y - size * 0.075);
    context.lineTo(inner + side * wing * 0.6, y - size * 0.075);
    context.stroke();
    context.save();
    context.fillStyle = colors.accentLight;
    context.shadowColor = withAlpha(colors.accent, 0.9);
    context.shadowBlur = size * 0.2;
    polygonPath(context, { x: inner, y }, WING.diamond * size, { sides: 4 });
    context.fill();
    context.beginPath();
    context.arc(inner + side * wing * 0.45, y, Math.max(1, size * 0.018), 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}

/**
 * The shadow the crest casts, the carved depth below its face, and its dark outline.
 * @param {CanvasRenderingContext2D} context
 * @param {Readonly<Record<string, string>>} colors
 * @param {Crest} crest
 * @param {string} text
 */
function paintCarving(context, colors, { left, baseline, size }, text) {
  context.save();
  context.shadowColor = withAlpha(colors.letterbox, 0.9);
  context.shadowBlur = SHADOW.blur * size;
  context.shadowOffsetY = SHADOW.drop * size;
  context.fillStyle = shade(colors.accentDark, -0.7);
  context.fillText(text, left, baseline + DEPTH.layers * DEPTH.step * size);
  context.restore();
  for (let layer = DEPTH.layers; layer >= 1; layer -= 1) {
    context.fillStyle = shade(colors.accentDark, -0.15 * layer);
    context.fillText(text, left, baseline + layer * DEPTH.step * size);
  }
  context.strokeStyle = withAlpha(colors.letterbox, 0.85);
  context.lineWidth = OUTLINE * size;
  context.strokeText(text, left, baseline);
}

/**
 * The face, polished like metal but long weathered: bright at the top, a
 * dark horizon across the middle, light again below; rust and wear over it
 * in patches; then a thin bright edge, chipped, as a worn bevel.
 * @param {CanvasRenderingContext2D} context
 * @param {Readonly<Record<string, string>>} colors
 * @param {Crest} crest
 * @param {{ text: string, rust: CanvasPattern | null, chips: readonly number[] }} wear
 */
function paintGold(context, colors, { left, baseline, top, size }, { text, rust, chips }) {
  const bright = mix(colors.accentLight, "#ffffff", 0.3);
  const tarnish = mix(colors.accentDark, "#5e2a0f", 0.45);
  const face = context.createLinearGradient(0, top, 0, baseline);
  face.addColorStop(0, bright);
  face.addColorStop(0.08, colors.accentLight);
  face.addColorStop(0.22, colors.accent);
  face.addColorStop(0.44, mix(colors.accent, "#c46a24", 0.35));
  face.addColorStop(0.52, tarnish);
  face.addColorStop(0.6, mix(colors.accent, colors.accentDark, 0.35));
  face.addColorStop(0.82, colors.accent);
  face.addColorStop(0.9, colors.accentLight);
  face.addColorStop(1, tarnish);
  context.fillStyle = face;
  context.fillText(text, left, baseline);
  if (rust !== null) {
    context.fillStyle = rust;
    context.fillText(text, left, baseline);
  }
  const edge = context.createLinearGradient(0, top, 0, baseline);
  edge.addColorStop(0, withAlpha(bright, 0.9));
  edge.addColorStop(0.45, withAlpha(bright, 0));
  edge.addColorStop(0.75, withAlpha(colors.accentDark, 0));
  edge.addColorStop(1, withAlpha(colors.accentDark, 0.8));
  context.strokeStyle = edge;
  context.lineWidth = Math.max(1, BEVEL * size);
  context.setLineDash(chips);
  context.strokeText(text, left, baseline);
  context.setLineDash([]);
}

/**
 * The arcane faction's tones, for the last letter's kindling (the focus blue in a theme without it).
 * @param {Readonly<Record<string, any>>} colors
 * @returns {{ light: string, base: string }}
 */
function arcane(colors) {
  const tones = colors.factions?.arcane;
  return tones === undefined ? { light: colors.focus, base: colors.focus } : tones;
}

/**
 * @param {string} family
 * @param {number} pixels
 */
function titleFont(family, pixels) {
  return `900 ${Math.max(1, Math.round(pixels))}px ${family}`;
}

/**
 * @param {Span} span
 * @param {() => number} random
 */
function between({ min, max }, random) {
  return min + random() * (max - min);
}
