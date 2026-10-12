/**
 * The player's ranked rating as a gold crest: a shield with the rating in
 * the display face and, on a ribbon across its foot, their place in the
 * season ("#4") or "NEW" while their rating is still provisional.
 * Decorative: pointer queries look through it.
 */
import { mix, withAlpha } from "../../theme/color.js";
import { bodyFont, displayFont } from "../../theme/Theme.js";
import { UiNode } from "../../ui/UiNode.js";

export class RatingCrest extends UiNode {
  /** The rating ("1500"). */
  rating;
  /** On the ribbon: the place ("#4") or "NEW". */
  place;

  /**
   * @param {{ id?: string, x: number, y: number, width: number, height: number, rating: number, place: string }} options
   */
  constructor({ id = "online.crest", x, y, width, height, rating, place }) {
    super({ id, x, y, width, height });
    this.passthrough = true;
    this.rating = String(rating);
    this.place = place;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const { x, y, width, height } = this.bounds;
    const { accent, accentLight, accentDark, accentText, letterbox } = theme.colors;
    const shield = { x: x + width * 0.08, y, width: width * 0.84, height: height * 0.86 };
    const half = shield.width / 2;
    const center = shield.x + half;
    context.save();
    const outline = () => {
      context.beginPath();
      context.moveTo(shield.x, shield.y + shield.height * 0.08);
      context.quadraticCurveTo(center, shield.y - shield.height * 0.06, shield.x + shield.width, shield.y + shield.height * 0.08);
      context.lineTo(shield.x + shield.width, shield.y + shield.height * 0.5);
      context.quadraticCurveTo(shield.x + shield.width, shield.y + shield.height * 0.86, center, shield.y + shield.height);
      context.quadraticCurveTo(shield.x, shield.y + shield.height * 0.86, shield.x, shield.y + shield.height * 0.5);
      context.closePath();
    };
    outline();
    const metal = context.createLinearGradient(shield.x, shield.y, shield.x + shield.width * 0.6, shield.y + shield.height);
    metal.addColorStop(0, mix(accentLight, "#ffffff", 0.2));
    metal.addColorStop(0.5, accent);
    metal.addColorStop(1, accentDark);
    context.shadowColor = withAlpha(accent, 0.6);
    context.shadowBlur = 14;
    context.fillStyle = metal;
    context.fill();
    context.shadowBlur = 0;
    context.lineWidth = 2;
    context.strokeStyle = mix(accentDark, letterbox, 0.3);
    context.stroke();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = bodyFont(theme, shield.height * 0.13, "bold");
    context.fillStyle = withAlpha(accentText, 0.75);
    context.fillText("RATING", center, shield.y + shield.height * 0.2);
    context.font = displayFont(theme, Math.min(shield.height * 0.36, (shield.width * 0.86) / Math.max(1, this.rating.length * 0.62)));
    context.fillStyle = accentText;
    context.fillText(this.rating, center, shield.y + shield.height * 0.47);
    // The ribbon across the shield's foot.
    const ribbon = { x, y: y + height - height * 0.3, width, height: height * 0.24 };
    context.beginPath();
    context.moveTo(ribbon.x, ribbon.y);
    context.lineTo(ribbon.x + ribbon.width, ribbon.y);
    context.lineTo(ribbon.x + ribbon.width - ribbon.height * 0.35, ribbon.y + ribbon.height / 2);
    context.lineTo(ribbon.x + ribbon.width, ribbon.y + ribbon.height);
    context.lineTo(ribbon.x, ribbon.y + ribbon.height);
    context.lineTo(ribbon.x + ribbon.height * 0.35, ribbon.y + ribbon.height / 2);
    context.closePath();
    context.fillStyle = mix(theme.colors.danger, letterbox, 0.25);
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = accentDark;
    context.stroke();
    context.font = bodyFont(theme, ribbon.height * 0.62, "bold");
    context.fillStyle = accentLight;
    context.fillText(this.place, x + width / 2, ribbon.y + ribbon.height / 2 + 1);
    context.restore();
  }
}
