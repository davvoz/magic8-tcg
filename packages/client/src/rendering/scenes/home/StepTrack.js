/**
 * The guide's steps in a row: those done in green with a tick, the next one
 * in gold, the others quiet. With `named` each is a pill with its name; a
 * phone's track is a row of short bars. Drawing only.
 */
import { drawTextInRect, fillRoundedRect } from "../../ui/drawing.js";
import { UiNode } from "../../ui/UiNode.js";
import { fitText } from "../../text/textUtils.js";
import { shade, withAlpha } from "../../theme/color.js";
import { scalableFont } from "../../theme/Theme.js";

const GAP = Object.freeze({ named: 10, bars: 6 });
const PILL_PADDING = 14;
const TICK = "✓ ";

export class StepTrack extends UiNode {
  /** @type {readonly { name: string, done: boolean, current: boolean }[]} */
  steps;
  named;

  /**
   * @param {{ id?: string, x: number, y: number, width: number, height: number, steps: readonly { name: string, done: boolean, current: boolean }[], named: boolean }} options
   */
  constructor({ steps, named, ...frame }) {
    super(frame);
    this.steps = steps;
    this.named = named;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    if (this.named) {
      this.#paintPills(context, theme);
    } else {
      this.#paintBars(context, theme);
    }
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  #paintPills(context, theme) {
    const area = this.bounds;
    const font = scalableFont(theme, "small", "bold");
    let x = area.x;
    for (const step of this.steps) {
      const text = step.done ? `${TICK}${step.name}` : step.name;
      context.font = font(theme.fonts.sizes.small);
      const width = Math.min(area.x + area.width - x, context.measureText(text).width + 2 * PILL_PADDING);
      if (width <= 2 * PILL_PADDING) {
        return;
      }
      const pill = { x, y: area.y, width, height: area.height };
      const look = this.#look(theme, step);
      fillRoundedRect(context, pill, { fill: look.fill, stroke: look.stroke, radius: area.height / 2, lineWidth: 1.5 });
      const fitted = fitText(context, { text, font, size: theme.fonts.sizes.small, width: width - 2 * PILL_PADDING, minScale: 0.85 });
      drawTextInRect(context, fitted.text, pill, { font: fitted.font, color: look.text, align: "center" });
      x += width + GAP.named;
    }
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  #paintBars(context, theme) {
    const area = this.bounds;
    const count = this.steps.length;
    const width = (area.width - (count - 1) * GAP.bars) / count;
    this.steps.forEach((step, index) => {
      const look = this.#look(theme, step);
      fillRoundedRect(context, { x: area.x + index * (width + GAP.bars), y: area.y, width, height: area.height }, { fill: look.bar, radius: area.height / 2 });
    });
  }

  /**
   * @param {import("../../theme/Theme.js").Theme} theme
   * @param {{ done: boolean, current: boolean }} step
   */
  #look(theme, step) {
    const { colors } = theme;
    if (step.done) {
      return { fill: withAlpha(shade(colors.success, -0.55), 0.9), stroke: withAlpha(colors.success, 0.5), text: colors.success, bar: colors.success };
    }
    if (step.current) {
      return { fill: colors.accent, stroke: colors.accentDark, text: colors.accentText, bar: colors.accent };
    }
    return { fill: withAlpha(colors.panelDark, 0.6), stroke: colors.panelBorder, text: colors.textMuted, bar: colors.panelLight };
  }
}
