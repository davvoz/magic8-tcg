/**
 * A decorative horizontal rule: a gold line fading out at both ends with
 * a small diamond at the centre. Separates a title from what follows.
 * Non-interactive.
 */
import { withAlpha } from "../theme/color.js";
import { polygonPath } from "./shapes.js";
import { UiNode } from "./UiNode.js";

const DIAMOND_SIDES = 4;

export class Ornament extends UiNode {
  /**
   * @param {{ id?: string, x: number, y: number, width: number, height: number }} area
   */
  constructor(area) {
    super(area);
    this.passthrough = true;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const centerY = area.y + area.height / 2;
    const color = theme.colors.accent;
    const gradient = context.createLinearGradient(area.x, centerY, area.x + area.width, centerY);
    gradient.addColorStop(0, withAlpha(color, 0));
    gradient.addColorStop(0.5, withAlpha(color, 0.9));
    gradient.addColorStop(1, withAlpha(color, 0));
    context.save();
    context.strokeStyle = gradient;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(area.x, centerY);
    context.lineTo(area.x + area.width, centerY);
    context.stroke();
    polygonPath(context, { x: area.x + area.width / 2, y: centerY }, area.height / 2, { sides: DIAMOND_SIDES });
    context.fillStyle = theme.colors.accentLight;
    context.shadowColor = withAlpha(color, 0.9);
    context.shadowBlur = area.height;
    context.fill();
    context.restore();
  }
}
