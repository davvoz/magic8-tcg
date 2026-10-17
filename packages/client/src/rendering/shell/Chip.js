/**
 * A pill in the top bar that keeps a figure in sight: a quiet label, then
 * the value in bold ("Wallet 12.500 STEEM", "Ranked entries 3"). Read-only.
 */
import { drawTextInRect, fillRoundedRect } from "../ui/drawing.js";
import { UiNode } from "../ui/UiNode.js";
import { fitText } from "../text/textUtils.js";
import { withAlpha } from "../theme/color.js";
import { scalableFont } from "../theme/Theme.js";

const PADDING = 14;
const GAP = 8;

export class Chip extends UiNode {
  label;
  value;
  /** Theme colour of the value. */
  valueKey;

  /**
   * @param {{ id: string, x: number, y: number, width: number, height: number, label: string, value: string, valueKey?: string }} options
   *   `label` may be empty: the value alone
   */
  constructor(options) {
    super(options);
    this.label = options.label;
    this.value = options.value;
    this.valueKey = options.valueKey ?? "text";
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const { colors } = theme;
    fillRoundedRect(context, area, { fill: withAlpha(colors.panel, 0.85), stroke: colors.panelBorder, radius: area.height / 2, lineWidth: 1.5 });
    const value = fitText(context, { text: this.value, font: scalableFont(theme, "small", "bold"), size: theme.fonts.sizes.small, width: area.width - 2 * PADDING, minScale: 0.75 });
    context.font = value.font;
    const valueWidth = context.measureText(value.text).width;
    const labelRoom = area.width - 2 * PADDING - valueWidth - GAP;
    const fittedLabel = this.label.length === 0 || labelRoom <= 0 ? null : fitText(context, { text: this.label, font: scalableFont(theme, "small"), size: theme.fonts.sizes.small, width: labelRoom, minScale: 1 });
    // A label is shown whole or not at all: the value is what matters.
    const label = fittedLabel?.text === this.label ? fittedLabel : null;
    context.font = label?.font ?? value.font;
    const labelWidth = label === null ? 0 : context.measureText(label.text).width;
    const total = labelWidth + (label === null ? 0 : GAP) + valueWidth;
    const startX = area.x + (area.width - total) / 2;
    if (label !== null) {
      drawTextInRect(context, label.text, { x: startX, y: area.y, width: labelWidth + 1, height: area.height }, { font: label.font, color: colors.textMuted, align: "left" });
    }
    drawTextInRect(context, value.text, { x: startX + total - valueWidth, y: area.y, width: valueWidth + 1, height: area.height }, { font: value.font, color: colors[this.valueKey] ?? colors.text, align: "left" });
  }
}
