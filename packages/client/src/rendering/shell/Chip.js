/**
 * A pill in the top bar that keeps a figure in sight: a quiet label, then
 * the value in bold ("Wallet 12 STEEM", "Ranked tickets 3"), led by a mark
 * when it has one (STEEM's, a ticket: glyphs.js). Read-only, unless it is
 * given something to do (`onActivate`): then it is a button, lit under the
 * pointer and when focused.
 */
import { SoundCue } from "../../application/audio/SoundCue.js";
import { drawTextInRect, fillRoundedRect } from "../ui/drawing.js";
import { drawGlyph, glyphWidth } from "../ui/glyphs.js";
import { UiNode } from "../ui/UiNode.js";
import { fitText } from "../text/textUtils.js";
import { withAlpha } from "../theme/color.js";
import { scalableFont } from "../theme/Theme.js";

const PADDING = 14;
const GAP = 8;
/** The glyph's height in the chip's. */
const GLYPH_SHARE = Object.freeze({ steem: 0.5, ticket: 0.56 });

export class Chip extends UiNode {
  label;
  value;
  /** Theme colour of the value. */
  valueKey;
  /** The mark before the words (one of Glyph), or null. @type {string | null} */
  glyph;
  /** What a click does, or null for a chip that only shows. @type {(() => void) | null} */
  onActivate;

  /**
   * @param {{ id: string, x: number, y: number, width: number, height: number, label: string, value: string, valueKey?: string, glyph?: string | null, onActivate?: (() => void) | null }} options
   *   `label` may be empty: the value alone
   */
  constructor(options) {
    super(options);
    this.label = options.label;
    this.value = options.value;
    this.valueKey = options.valueKey ?? "text";
    this.glyph = options.glyph ?? null;
    this.onActivate = options.onActivate ?? null;
    this.interactive = this.onActivate !== null;
    this.focusable = this.onActivate !== null;
    this.activationCue = this.onActivate === null ? null : SoundCue.UI_CLICK;
  }

  activate() {
    if (this.onActivate !== null && this.isEffectivelyEnabled && this.isEffectivelyVisible) {
      this.onActivate();
    }
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const { colors } = theme;
    this.#paintFace(context, theme);
    const glyphHeight = area.height * (GLYPH_SHARE[/** @type {keyof typeof GLYPH_SHARE} */ (this.glyph ?? "steem")] ?? 0.5);
    const glyph = this.glyph === null ? 0 : glyphWidth(this.glyph, glyphHeight) + GAP;
    const value = fitText(context, { text: this.value, font: scalableFont(theme, "small", "bold"), size: theme.fonts.sizes.small, width: area.width - 2 * PADDING - glyph, minScale: 0.75 });
    context.font = value.font;
    const valueWidth = context.measureText(value.text).width;
    const label = this.#fittedLabel(context, theme, area.width - 2 * PADDING - glyph - valueWidth - GAP);
    context.font = label?.font ?? value.font;
    const labelWidth = label === null ? 0 : context.measureText(label.text).width;
    const words = labelWidth + (label === null ? 0 : GAP) + valueWidth;
    const total = glyph + words;
    const glyphX = area.x + (area.width - total) / 2;
    if (this.glyph !== null) {
      drawGlyph(context, theme, this.glyph, { x: glyphX, y: area.y + area.height / 2, height: glyphHeight });
    }
    const startX = glyphX + glyph;
    if (label !== null) {
      drawTextInRect(context, label.text, { x: startX, y: area.y, width: labelWidth + 1, height: area.height }, { font: label.font, color: colors.textMuted, align: "left" });
    }
    drawTextInRect(context, value.text, { x: startX + words - valueWidth, y: area.y, width: valueWidth + 1, height: area.height }, { font: value.font, color: colors[this.valueKey] ?? colors.text, align: "left" });
  }

  /**
   * The label in the room it has: whole or not at all (the value is what matters).
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {number} room
   */
  #fittedLabel(context, theme, room) {
    if (this.label.length === 0 || room <= 0) {
      return null;
    }
    const fitted = fitText(context, { text: this.label, font: scalableFont(theme, "small"), size: theme.fonts.sizes.small, width: room, minScale: 1 });
    return fitted.text === this.label ? fitted : null;
  }

  /**
   * The pill: lit under the pointer when it can be clicked, ringed when focused.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  #paintFace(context, theme) {
    const { colors } = theme;
    const area = this.bounds;
    const lit = this.onActivate !== null && (this.hovered || this.focused);
    let stroke = colors.panelBorder;
    if (this.focused) {
      stroke = colors.focus;
    } else if (lit) {
      stroke = colors.accent;
    }
    fillRoundedRect(context, area, { fill: lit ? colors.hover : withAlpha(colors.panel, 0.85), stroke, radius: area.height / 2, lineWidth: this.focused ? 2.5 : 1.5 });
  }
}
