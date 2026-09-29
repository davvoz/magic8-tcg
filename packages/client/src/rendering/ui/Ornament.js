/**
 * A decorative horizontal rule: a gold line fading out at both ends with
 * the painted medallion at the centre (Theme.uiArt), or a small diamond
 * while its image is not ready. Separates a title from what follows.
 * Non-interactive.
 */
import { inPixels, UiPiece } from "../images/UiArt.js";
import { withAlpha } from "../theme/color.js";
import { polygonPath } from "./shapes.js";
import { UiNode } from "./UiNode.js";

const DIAMOND_SIDES = 4;
/** The medallion's height, in multiples of the rule's height; it overflows the rule above and below. */
const MEDALLION_HEIGHT = 2.6;
/** How far into the medallion the line reaches, as a fraction of its half-width. */
const LINE_REACH = 0.9;

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
    const center = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
    const color = theme.colors.accent;
    const art = theme.uiArt;
    const image = art?.imageFor(UiPiece.DIVIDER) ?? null;
    const gradient = context.createLinearGradient(area.x, center.y, area.x + area.width, center.y);
    gradient.addColorStop(0, withAlpha(color, 0));
    gradient.addColorStop(0.5, withAlpha(color, 0.9));
    gradient.addColorStop(1, withAlpha(color, 0));
    context.save();
    context.strokeStyle = gradient;
    context.lineWidth = 1.5;
    if (art === undefined || image === null) {
      strokeRule(context, area, center, 0);
      polygonPath(context, center, area.height / 2, { sides: DIAMOND_SIDES });
      context.fillStyle = theme.colors.accentLight;
      context.shadowColor = withAlpha(color, 0.9);
      context.shadowBlur = area.height;
      context.fill();
    } else {
      const crop = inPixels(art.layout.divider, image);
      const height = area.height * MEDALLION_HEIGHT;
      const width = (height * crop.width) / crop.height;
      // The line stops at the medallion, whose dark interior would otherwise let it show through.
      strokeRule(context, area, center, (width / 2) * LINE_REACH);
      context.globalCompositeOperation = "screen";
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image.source, crop.x, crop.y, crop.width, crop.height, center.x - width / 2, center.y - height / 2, width, height);
    }
    context.restore();
  }
}

/**
 * The rule across the area, leaving a gap of `halfGap` on each side of the centre.
 * @param {CanvasRenderingContext2D} context
 * @param {import("@magic8/engine/shared/geometry.js").Rect} area
 * @param {{ x: number, y: number }} center
 * @param {number} halfGap
 */
function strokeRule(context, area, center, halfGap) {
  context.beginPath();
  context.moveTo(area.x, center.y);
  context.lineTo(center.x - halfGap, center.y);
  context.moveTo(center.x + halfGap, center.y);
  context.lineTo(area.x + area.width, center.y);
  context.stroke();
}
