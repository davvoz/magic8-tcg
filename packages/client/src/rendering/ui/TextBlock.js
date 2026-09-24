import { drawTextInRect } from "./drawing.js";
import { UiNode } from "./UiNode.js";
import { wrapText } from "../text/textUtils.js";
import { fontFor } from "../theme/Theme.js";

const LINE_GAP = 4;

/** Word-wrapped text; lines that do not fit the height are dropped. */
export class TextBlock extends UiNode {
  text;
  /** @type {import("../theme/Theme.js").FontSize} */
  size;
  /** @type {CanvasTextAlign} */
  align;
  /** @type {string | null} */
  colorKey;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, text: string, size?: import("../theme/Theme.js").FontSize, align?: CanvasTextAlign, colorKey?: string | null }} options
   */
  constructor(options) {
    super(options);
    this.text = options.text;
    this.size = options.size ?? "body";
    this.align = options.align ?? "left";
    this.colorKey = options.colorKey ?? null;
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
    context.font = font;
    const lines = wrapText((text) => context.measureText(text).width, this.text, area.width);
    lines.forEach((line, index) => {
      const y = area.y + index * lineHeight;
      if (y + lineHeight <= area.y + area.height) {
        drawTextInRect(context, line, { x: area.x, y, width: area.width, height: lineHeight }, { font, color, align: this.align });
      }
    });
  }
}
