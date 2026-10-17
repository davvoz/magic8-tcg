import { drawAvatar } from "./avatar.js";
import { drawGlyph, glyphWidth } from "./glyphs.js";
import { drawOutlinedText, drawTextInRect } from "./drawing.js";
import { UiNode } from "./UiNode.js";
import { fitText } from "../text/textUtils.js";
import { withAlpha } from "../theme/color.js";
import { fontFor, scalableFont } from "../theme/Theme.js";

const GLOW_BLUR = 18;
/** Space between a portrait and the text after it. */
const AVATAR_GAP = 8;
/** A glyph's height in its text's size, and the space after it. */
const GLYPH_SCALE = 1.05;
const GLYPH_GAP = 6;

/**
 * Single-line text, optionally truncated with an ellipsis to its width.
 * `glow` draws it outlined with a halo in its own colour, for titles.
 * `avatar` (an account) puts that player's portrait, as tall as the label,
 * before the text; `glyph` (glyphs.js) a mark instead (STEEM's, a ticket),
 * sized to the text and kept beside it whatever the alignment.
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
  /** The mark that leads the text (one of Glyph), or null for none. @type {string | null} */
  glyph;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, text: string, size?: import("../theme/Theme.js").FontSize, align?: CanvasTextAlign, weight?: "normal" | "bold", colorKey?: string | null, padding?: number, fit?: boolean, glow?: boolean, avatar?: string | null, glyph?: string | null }} options
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
    this.glyph = options.glyph ?? null;
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
    const glyph = this.glyph === null ? 0 : this.#glyphRoom(theme);
    const room = { ...area, x: area.x + glyph, width: Math.max(0, area.width - glyph) };
    const { text, font: set } = this.fit ? this.#fitted(context, theme, room.width) : { text: this.text, font };
    if (this.glyph !== null) {
      this.#paintGlyph(context, theme, { room, text, font: set, lead: glyph });
    }
    const textArea = this.glyph === null ? area : room;
    if (this.glow) {
      drawOutlinedText(context, text, textArea, { font: set, color, outline: withAlpha(theme.colors.letterbox, 0.85), outlineWidth: 4, glow: withAlpha(color, 0.75), glowBlur: GLOW_BLUR, align: this.align, padding: this.padding });
      return;
    }
    drawTextInRect(context, text, textArea, { font: set, color, align: this.align, padding: this.padding });
  }

  /** The glyph's room before the text: the glyph at the text's height, and a gap. @param {import("../theme/Theme.js").Theme} theme */
  #glyphRoom(theme) {
    return glyphWidth(/** @type {string} */ (this.glyph), this.#glyphHeight(theme)) + GLYPH_GAP;
  }

  /** @param {import("../theme/Theme.js").Theme} theme */
  #glyphHeight(theme) {
    return Math.min(this.height, theme.fonts.sizes[this.size] * GLYPH_SCALE);
  }

  /**
   * The glyph, just before where the text starts (aligned as the text is).
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {{ room: import("@magic8/engine/shared/geometry.js").Rect, text: string, font: string, lead: number }} parts
   */
  #paintGlyph(context, theme, { room, text, font, lead }) {
    context.font = font;
    const width = Math.min(room.width, context.measureText(text).width);
    const start = { left: room.x + this.padding, center: room.x + (room.width - width) / 2, right: room.x + room.width - this.padding - width }[/** @type {"left" | "center" | "right"} */ (this.align)] ?? room.x;
    drawGlyph(context, theme, /** @type {string} */ (this.glyph), { x: start - lead, y: room.y + room.height / 2, height: this.#glyphHeight(theme) });
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
   * The text fitted to the label's width: smaller where the theme allows it (a phone), then cut.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {number} width
   */
  #fitted(context, theme, width) {
    return fitText(context, { text: this.text, font: scalableFont(theme, this.size, this.weight), size: theme.fonts.sizes[this.size], width: Math.max(0, width - 2 * this.padding), minScale: theme.textFit?.minScale ?? 1 });
  }
}
