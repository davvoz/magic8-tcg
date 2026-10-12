/**
 * A row of small pills, each with a check mark: what a way to play gives
 * ("Free", "No rating at stake"). Each pill is as wide as its words; the row
 * is set in a smaller size when it would not fit. In a way to play's tone.
 * Decorative: pointer queries look through it.
 */
import { withAlpha } from "../../theme/color.js";
import { bodyFont } from "../../theme/Theme.js";
import { fillRoundedRect } from "../../ui/drawing.js";
import { drawCheckIcon } from "../../ui/shapes.js";
import { UiNode } from "../../ui/UiNode.js";
import { playTone } from "./lobbyIcons.js";

/** Inside a pill: the space before the check, the check's size, the space after it and after the words; between pills. */
const PILL = Object.freeze({ lead: 10, check: 12, space: 7, tail: 12, gap: 10 });

export class Perks extends UiNode {
  /** @type {readonly string[]} */
  items;
  /** One of PlayKind. */
  kind;

  /**
   * @param {{ id?: string, x: number, y: number, width: number, height: number, items: readonly string[], kind: string }} options
   */
  constructor({ id = "", x, y, width, height, items, kind }) {
    super({ id, x, y, width, height });
    this.passthrough = true;
    this.items = items;
    this.kind = kind;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const tone = playTone(theme, this.kind);
    const chrome = PILL.lead + PILL.check + PILL.space + PILL.tail;
    let size = theme.fonts.sizes.small;
    const widths = () => {
      context.font = bodyFont(theme, size, "bold");
      return this.items.map((item) => context.measureText(item).width + chrome);
    };
    let measured = widths();
    const total = () => measured.reduce((sum, width) => sum + width, 0) + PILL.gap * (this.items.length - 1);
    if (total() > area.width) {
      size = Math.max(theme.fonts.sizes.micro, size * ((area.width - chrome * this.items.length - PILL.gap * (this.items.length - 1)) / (total() - chrome * this.items.length - PILL.gap * (this.items.length - 1))));
      measured = widths();
    }
    context.save();
    context.textAlign = "left";
    context.textBaseline = "middle";
    let x = area.x;
    this.items.forEach((item, index) => {
      const pill = { x, y: area.y, width: measured[index], height: area.height };
      fillRoundedRect(context, pill, { fill: withAlpha(tone.base, 0.14), stroke: withAlpha(tone.base, 0.55), radius: area.height / 2, lineWidth: 1 });
      const middle = area.y + area.height / 2;
      drawCheckIcon(context, { x: x + PILL.lead + PILL.check / 2, y: middle }, PILL.check, { color: tone.light });
      context.font = bodyFont(theme, size, "bold");
      context.fillStyle = theme.colors.text;
      context.fillText(item, x + PILL.lead + PILL.check + PILL.space, middle + 1);
      x += measured[index] + PILL.gap;
    });
    context.restore();
  }
}
