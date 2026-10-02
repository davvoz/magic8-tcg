import { drawAvatar } from "./avatar.js";
import { drawOutlinedText, drawTextInRect } from "./drawing.js";
import { UiNode } from "./UiNode.js";
import { ellipsize } from "../text/textUtils.js";
import { withAlpha } from "../theme/color.js";
import { fontFor } from "../theme/Theme.js";

const GLOW_BLUR = 18;
/** Space between a portrait and the text after it. */
const AVATAR_GAP = 8;

/**
 * Single-line text, optionally truncated with an ellipsis to its width.
 * `glow` draws it outlined with a halo in its own colour, for titles.
 * `avatar` (an account) puts that player's portrait, as tall as the label,
 * before the text.
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
  /** The account whose portrait leads the text, or null for none. @type {string | null} */
  avatar;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, text: string, size?: import("../theme/Theme.js").FontSize, align?: CanvasTextAlign, weight?: "normal" | "bold", colorKey?: string | null, padding?: number, fit?: boolean, glow?: boolean, avatar?: string | null }} options
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
    this.avatar = options.avatar ?? null;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const color = this.colorKey === null ? theme.colors.text : theme.colors[this.colorKey] ?? theme.colors.text;
    const font = fontFor(theme, this.size, this.weight);
    const area = this.#textArea();
    if (this.avatar !== null) {
      const { x, y, height } = this.bounds;
      drawAvatar(context, theme, { account: this.avatar, center: { x: x + height / 2, y: y + height / 2 }, radius: height / 2 - 1 });
    }
    const text = this.fit ? this.#fitted(context, font, area.width) : this.text;
    if (this.glow) {
      drawOutlinedText(context, text, area, { font, color, outline: withAlpha(theme.colors.letterbox, 0.85), outlineWidth: 4, glow: withAlpha(color, 0.75), glowBlur: GLOW_BLUR, align: this.align, padding: this.padding });
      return;
    }
    drawTextInRect(context, text, area, { font, color, align: this.align, padding: this.padding });
  }

  /** Where the text goes: the whole label, or what the portrait leaves of it. */
  #textArea() {
    const area = this.bounds;
    if (this.avatar === null) {
      return area;
    }
    const lead = area.height + AVATAR_GAP;
    return { ...area, x: area.x + lead, width: Math.max(0, area.width - lead) };
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {string} font
   * @param {number} width
   */
  #fitted(context, font, width) {
    context.font = font;
    return ellipsize((text) => context.measureText(text).width, this.text, Math.max(0, width - 2 * this.padding));
  }
}
