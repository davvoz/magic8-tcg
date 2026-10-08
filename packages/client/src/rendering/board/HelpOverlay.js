/**
 * The match help on the board, loud enough to be seen rather than read:
 * - the headline: two or three words over the middle of the table, big,
 *   glowing in the colour of what is to be done, beating like a heart;
 * - the pointers: on each thing that can be used now, a thick pulsing ring,
 *   a fat bouncing arrow and a one-word label ("PLAY", "ATTACK", "END TURN").
 * The suggested move is in the colour of its kind (HelpTone): playing green,
 * attacking orange, blocking blue, a target red, moving on gold; the other
 * options are in white.
 * Both let taps through.
 */
import { HelpTone } from "../../application/help/matchHelp.js";
import { withAlpha } from "../theme/color.js";
import { fontFor } from "../theme/Theme.js";
import { drawOutlinedText, fillRoundedRect, glowRoundedRect } from "../ui/drawing.js";
import { drawArrow } from "../ui/shapes.js";
import { UiNode } from "../ui/UiNode.js";

/** @typedef {import("@magic8/engine/shared/geometry.js").Rect} Rect */
/** @typedef {"above" | "below" | "left" | "right"} Side where a pointer's arrow comes from */
/** @typedef {Readonly<{ area: Rect, label: string, from: Side, primary?: boolean }>} Pointer `primary`: the suggested move (the default), not another option */

/** The theme colour of each HelpTone. */
const TONE_COLORS = Object.freeze({
  [HelpTone.PLAY]: "success",
  [HelpTone.ATTACK]: "attack",
  [HelpTone.BLOCK]: "focus",
  [HelpTone.TARGET]: "danger",
  [HelpTone.NEXT]: "accent",
});

/** One beat of the pulse and the bounce: quick, to catch the eye. */
const BEAT_MS = 900;
/** How far the headline swells at the top of a beat. */
const SWELL = 0.06;
/** The pointers, wide and compact: the ring, the arrow, the label. */
const WIDE = Object.freeze({ ring: 6, ringWidth: 4, blur: 22, arrow: 46, arrowWidth: 10, head: 28, outline: 6, bob: 12, gap: 4, labelSize: /** @type {const} */ ("body"), labelHeight: 30, labelPad: 12 });
const COMPACT = Object.freeze({ ring: 4, ringWidth: 3, blur: 14, arrow: 22, arrowWidth: 6, head: 16, outline: 4, bob: 6, gap: 2, labelSize: /** @type {const} */ ("tiny"), labelHeight: 18, labelPad: 6 });
/** The headline's plate round its words. */
const HEADLINE = Object.freeze({ padX: 22, padY: 4, outline: 6, glow: 18 });
/** Unit vectors from a pointer's target towards where its arrow comes from. */
const DIRECTIONS = Object.freeze({ above: { x: 0, y: -1 }, below: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } });
const OPPOSITE = Object.freeze({ above: "below", below: "above", left: "right", right: "left" });

/**
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {string} tone a HelpTone
 */
export function toneColor(theme, tone) {
  const key = /** @type {keyof typeof theme.colors} */ (TONE_COLORS[tone] ?? "accent");
  return /** @type {string} */ (theme.colors[key]);
}

/** @param {number} timeMs */
function beat(timeMs) {
  return (1 - Math.cos((2 * Math.PI * (timeMs % BEAT_MS)) / BEAT_MS)) / 2;
}

/** The help's headline over the middle of the table. */
export class HelpHeadline extends UiNode {
  text;
  tone;
  #compact;
  #clock;

  /**
   * @param {{ text: string, tone: string, area: Rect, compact: boolean, clock: () => number }} options `area`: the room it is centred in
   */
  constructor({ text, tone, area, compact, clock }) {
    super({ id: "help.headline", ...area });
    this.text = text;
    this.tone = tone;
    this.#compact = compact;
    this.#clock = clock;
    this.passthrough = true;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const color = toneColor(theme, this.tone);
    const font = fontFor(theme, this.#compact ? "body" : "heading", "bold");
    const size = theme.fonts.sizes[this.#compact ? "body" : "heading"];
    context.save();
    context.font = font;
    const width = Math.min(area.width, context.measureText(this.text).width + 2 * HEADLINE.padX);
    const height = size + 2 * HEADLINE.padY;
    const centre = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
    const swell = 1 + SWELL * beat(this.#clock());
    context.translate(centre.x, centre.y);
    context.scale(swell, swell);
    const plate = { x: -width / 2, y: -height / 2, width, height };
    fillRoundedRect(context, plate, { fill: withAlpha(theme.colors.panelDark, 0.92), radius: height / 2 });
    glowRoundedRect(context, plate, { color, radius: height / 2, blur: HEADLINE.glow, lineWidth: 3 });
    drawOutlinedText(context, this.text, plate, { font, color, outline: withAlpha(theme.colors.letterbox, 0.9), outlineWidth: HEADLINE.outline, glow: color, glowBlur: HEADLINE.glow });
    context.restore();
  }
}

/** Rings, bouncing arrows and labels on everything that can be used now. */
export class HelpPointers extends UiNode {
  pointers;
  tone;
  #bounds;
  #m;
  #clock;

  /**
   * @param {{ pointers: readonly Pointer[], tone: string, bounds: Rect, compact: boolean, clock: () => number }} options
   *   `bounds`: what the arrows and labels must stay in (one that would leave it comes from the other side)
   */
  constructor({ pointers, tone, bounds, compact, clock }) {
    super({ id: "help.pointers" });
    this.pointers = pointers;
    this.tone = tone;
    this.#bounds = bounds;
    this.#m = compact ? COMPACT : WIDE;
    this.#clock = clock;
    this.passthrough = true;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const m = this.#m;
    const wave = beat(this.#clock());
    const suggested = toneColor(theme, this.tone);
    const font = fontFor(theme, m.labelSize, "bold");
    context.save();
    context.font = font;
    for (const { area, label, from, primary = true } of this.pointers) {
      const color = primary ? suggested : theme.colors.text;
      glowRoundedRect(context, inflate(area, m.ring), { color: withAlpha(color, 0.55 + 0.45 * wave), radius: theme.spacing.radius + m.ring, blur: m.blur, lineWidth: m.ringWidth });
      const labelWidth = context.measureText(label).width + 2 * m.labelPad;
      const side = this.#sideFor(area, from, labelWidth);
      const d = DIRECTIONS[side];
      const bob = m.bob * wave;
      const tip = edgePoint(inflate(area, m.ring + m.gap + bob), d);
      const tail = { x: tip.x + d.x * m.arrow, y: tip.y + d.y * m.arrow };
      drawArrow(context, tail, tip, { color: withAlpha(theme.colors.letterbox, 0.85), width: m.arrowWidth + m.outline, headSize: m.head + m.outline });
      drawArrow(context, tail, tip, { color, width: m.arrowWidth, headSize: m.head });
      const reach = (d.x === 0 ? m.labelHeight : labelWidth) / 2;
      const centre = { x: tail.x + d.x * reach, y: tail.y + d.y * reach };
      const pill = { x: centre.x - labelWidth / 2, y: centre.y - m.labelHeight / 2, width: labelWidth, height: m.labelHeight };
      fillRoundedRect(context, pill, { fill: color, stroke: withAlpha(theme.colors.letterbox, 0.85), radius: m.labelHeight / 2, lineWidth: 2 });
      drawOutlinedText(context, label, pill, { font, color: theme.colors.accentText, outline: withAlpha("#ffffff", 0.35), outlineWidth: 1 });
    }
    context.restore();
  }

  /**
   * The side an arrow comes from: the one asked for, unless the arrow and its label would leave the bounds there.
   * @param {Rect} area
   * @param {Side} from
   * @param {number} labelWidth
   * @returns {Side}
   */
  #sideFor(area, from, labelWidth) {
    const m = this.#m;
    const bounds = this.#bounds;
    const reach = m.ring + m.gap + m.bob + m.arrow + (from === "above" || from === "below" ? m.labelHeight : labelWidth);
    const fits = {
      above: area.y - reach >= bounds.y,
      below: area.y + area.height + reach <= bounds.y + bounds.height,
      left: area.x - reach >= bounds.x,
      right: area.x + area.width + reach <= bounds.x + bounds.width,
    };
    return fits[from] ? from : OPPOSITE[from];
  }
}

/**
 * The middle of the side of `area` that faces `direction`.
 * @param {Rect} area
 * @param {{ x: number, y: number }} direction
 */
function edgePoint(area, direction) {
  return { x: area.x + area.width / 2 + (direction.x * area.width) / 2, y: area.y + area.height / 2 + (direction.y * area.height) / 2 };
}

/**
 * @param {Rect} area
 * @param {number} by
 * @returns {Rect}
 */
function inflate(area, by) {
  return { x: area.x - by, y: area.y - by, width: area.width + 2 * by, height: area.height + 2 * by };
}
