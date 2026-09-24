/**
 * The attack (sword) and health (shield) gems shared by card faces and
 * list strips: a faceted octagon in the stat's colour with the pictogram
 * ghosted behind an outlined number.
 */
import { shade, withAlpha } from "../theme/color.js";
import { bodyFont } from "../theme/Theme.js";
import { drawOutlinedText, verticalGradient } from "../ui/drawing.js";
import { drawGem, drawShieldIcon, drawSwordIcon } from "../ui/shapes.js";

/** @typedef {"sword" | "shield"} StatIcon */

const ICON_STYLE = Object.freeze({ blade: withAlpha("#ffffff", 0.35), hilt: withAlpha("#000000", 0.35), fill: withAlpha("#ffffff", 0.18), rim: withAlpha("#000000", 0.3) });

/**
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ center: { x: number, y: number }, radius: number, value: number, color: string, icon: StatIcon, glow?: boolean }} stat
 */
export function drawStatGem(context, theme, { center, radius, value, color, icon, glow = false }) {
  const box = { x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2 };
  context.save();
  if (glow) {
    context.shadowColor = withAlpha(color, 0.7);
    context.shadowBlur = radius * 0.8;
  }
  drawGem(context, center, radius, { fill: verticalGradient(context, box, [[0, shade(color, 0.2)], [1, shade(color, -0.5)]]), rim: theme.colors.accent, highlight: withAlpha("#ffffff", 0.3), sides: 8, rimWidth: Math.max(1, radius * 0.12) });
  context.restore();
  if (icon === "sword") {
    drawSwordIcon(context, center, radius * 1.3, ICON_STYLE);
  } else {
    drawShieldIcon(context, center, radius * 1.3, ICON_STYLE);
  }
  drawOutlinedText(context, String(value), box, { font: bodyFont(theme, radius * 1.25, "bold"), color: theme.colors.text, outline: withAlpha("#000000", 0.85), outlineWidth: Math.max(1.5, radius * 0.16) });
}

/**
 * The cost gem: a hexagon in the resource colour with a gold rim.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ center: { x: number, y: number }, radius: number, value: number }} cost
 */
export function drawCostGem(context, theme, { center, radius, value }) {
  const box = { x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2 };
  const resource = theme.colors.resource;
  drawGem(context, center, radius, { fill: verticalGradient(context, box, [[0, shade(resource, 0.35)], [1, shade(resource, -0.45)]]), rim: theme.colors.accent, highlight: withAlpha("#ffffff", 0.35), rimWidth: Math.max(1, radius * 0.14) });
  drawOutlinedText(context, String(value), box, { font: bodyFont(theme, radius * 1.3, "bold"), color: theme.colors.text, outline: withAlpha("#000000", 0.85), outlineWidth: Math.max(1.5, radius * 0.18) });
}
