import { drawOutlinedText, drawTextInRect } from "./drawing.js";
import { UiNode } from "./UiNode.js";
import { ellipsize } from "../text/textUtils.js";
import { withAlpha } from "../theme/color.js";
import { fontFor } from "../theme/Theme.js";

const GLOW_BLUR = 18;

/**
 * Single-line text, optionally truncated with an ellipsis to its width.
 * `glow` draws it outlined with a halo in its own colour, for titles.
 */
export class Label extends UiNode {
  text;
  /** @type {import("../theme/Theme.js").FontSize} */
  size;
  /** @type {CanvasTextAlign} */
  align;
  /** @type {"normal" | "bold"} */
  weight;
  /** Theme colour key; null uses `colors.text`. @type {string | null} */
  colorKey;
  /** Horizontal inset for left/right alignment and for the ellipsis budget. */
  padding;
  /** Truncate with "…" instead of overflowing. */
  fit;
  /** Outline plus halo, for display text over the backdrop. */
  glow;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, text: string, size?: import("../theme/Theme.js").FontSize, align?: CanvasTextAlign, weight?: "normal" | "bold", colorKey?: string | null, padding?: number, fit?: boolean, glow?: boolean }} options
   */
  constructor(options) {
    super(options);
    this.text = options.text;
    this.size = options.size ?? "body";
    this.align = options.align ?? "center";
    this.weight = options.weight ?? "normal";
    this.colorKey = options.colorKey ?? null;
    this.padding = options.padding ?? 0;
    this.fit = options.fit ?? false;
    this.glow = options.glow ?? false;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const color = this.colorKey === null ? theme.colors.text : theme.colors[this.colorKey] ?? theme.colors.text;
    const font = fontFor(theme, this.size, this.weight);
    const text = this.fit ? this.#fitted(context, font) : this.text;
    if (this.glow) {
      drawOutlinedText(context, text, this.bounds, { font, color, outline: withAlpha(theme.colors.letterbox, 0.85), outlineWidth: 4, glow: withAlpha(color, 0.75), glowBlur: GLOW_BLUR, align: this.align, padding: this.padding });
      return;
    }
    drawTextInRect(context, text, this.bounds, { font, color, align: this.align, padding: this.padding });
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {string} font
   */
  #fitted(context, font) {
    context.font = font;
    return ellipsize((text) => context.measureText(text).width, this.text, Math.max(0, this.width - 2 * this.padding));
  }
}
