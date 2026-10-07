import { drawTextInRect } from "./drawing.js";
import { UiNode } from "./UiNode.js";
import { wrapText } from "../text/textUtils.js";
import { drawRuns, wrapRuns } from "../text/keywordText.js";
import { fontFor } from "../theme/Theme.js";

const LINE_GAP = 4;

/** Word-wrapped text; lines that do not fit the height are dropped. A card's `keywords` in it are drawn in bold gold. */
export class TextBlock extends UiNode {
  text;
  /** @type {import("../theme/Theme.js").FontSize} */
  size;
  /** @type {CanvasTextAlign} */
  align;
  /** @type {string | null} */
  colorKey;
  /** Words drawn in bold gold (a card's keywords); the lines are then left-aligned. @type {readonly string[]} */
  keywords;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, text: string, size?: import("../theme/Theme.js").FontSize, align?: CanvasTextAlign, colorKey?: string | null, keywords?: readonly string[] }} options
   */
  constructor(options) {
    super(options);
    this.text = options.text;
    this.size = options.size ?? "body";
    this.align = options.align ?? "left";
    this.colorKey = options.colorKey ?? null;
    this.keywords = options.keywords ?? [];
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const font = fontFor(theme, this.size);
    const color = this.colorKey === null ? theme.colors.text : theme.colors[this.colorKey] ?? theme.colors.text;
    const lineHeight = theme.fonts.sizes[this.size] + LINE_GAP;
    const area = this.bounds;
    const lineAt = (/** @type {number} */ index) => ({ x: area.x, y: area.y + index * lineHeight, width: area.width, height: lineHeight });
    const fits = (/** @type {number} */ index) => (index + 1) * lineHeight <= area.height;
    if (this.keywords.length > 0) {
      const style = { font, keywordFont: fontFor(theme, this.size, "bold"), color, keywordColor: theme.colors.accentLight };
      wrapRuns(context, this.text, { keywords: this.keywords, width: area.width, style }).forEach((runs, index) => {
        if (fits(index)) {
          drawRuns(context, runs, lineAt(index), style);
        }
      });
      return;
    }
    context.font = font;
    const lines = wrapText((text) => context.measureText(text).width, this.text, area.width);
    lines.forEach((line, index) => {
      if (fits(index)) {
        drawTextInRect(context, line, lineAt(index), { font, color, align: this.align });
      }
    });
  }
}
