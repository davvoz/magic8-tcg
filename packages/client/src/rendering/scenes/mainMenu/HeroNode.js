/**
 * The main menu's centrepiece: a fan of card backs rising out of a pool of
 * light, drawn behind the title. Decorative and non-interactive; the fan
 * is procedural (card backs from CardRenderer, rotated around a pivot).
 */
import { drawCardBack } from "../../cards/CardRenderer.js";
import { withAlpha } from "../../theme/color.js";
import { radialGradient } from "../../ui/drawing.js";
import { UiNode } from "../../ui/UiNode.js";

const CARD = Object.freeze({ width: 150, height: 210 });
/** Cards hang from a pivot well below the area, so they fan like a hand; `top` is where the middle card starts. */
const FAN = Object.freeze({ count: 5, spreadRadians: 0.5, pivotBelow: 260, top: 30 });

export class HeroNode extends UiNode {
  /**
   * @param {{ x: number, y: number, width: number, height: number }} area the fan is centred horizontally near the area's top
   */
  constructor(area) {
    super({ id: "hero", ...area });
    this.passthrough = true;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const center = { x: area.x + area.width / 2, y: area.y + area.height * 0.45 };
    context.save();
    context.fillStyle = radialGradient(context, center, area.height * 0.9, [[0, withAlpha(theme.colors.accent, 0.35)], [0.5, withAlpha(theme.colors.accent, 0.08)], [1, withAlpha(theme.colors.accent, 0)]]);
    context.fillRect(area.x, area.y, area.width, area.height);
    context.restore();
    const pivot = { x: center.x, y: area.y + area.height + FAN.pivotBelow };
    for (let index = 0; index < FAN.count; index += 1) {
      const angle = (index / (FAN.count - 1) - 0.5) * FAN.spreadRadians;
      context.save();
      context.translate(pivot.x, pivot.y);
      context.rotate(angle);
      context.shadowColor = withAlpha(theme.colors.letterbox, 0.8);
      context.shadowBlur = 24;
      drawCardBack(context, theme, { x: -CARD.width / 2, y: area.y + FAN.top - pivot.y, width: CARD.width, height: CARD.height });
      context.restore();
    }
  }
}
