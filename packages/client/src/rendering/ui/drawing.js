/**
 * Small drawing helpers shared by widgets, cards and scenes: rounded
 * rectangles, gradients, glows, bevels and text. Everything is procedural
 * (no images), and every colour comes from the caller so nothing here
 * knows the theme.
 */
import { withAlpha } from "../theme/color.js";

/** @typedef {import("@magic8/engine/shared/geometry.js").Rect} Rect */

/**
 * @param {CanvasRenderingContext2D} context
 * @param {Rect} area
 * @param {number} radius
 */
export function roundedRectPath(context, area, radius) {
  const r = Math.max(0, Math.min(radius, area.width / 2, area.height / 2));
  const { x, y, width, height } = area;
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.arcTo(x + width, y, x + width, y + r, r);
  context.lineTo(x + width, y + height - r);
  context.arcTo(x + width, y + height, x + width - r, y + height, r);
  context.lineTo(x + r, y + height);
  context.arcTo(x, y + height, x, y + height - r, r);
  context.lineTo(x, y + r);
  context.arcTo(x, y, x + r, y, r);
  context.closePath();
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {Rect} area
 * @param {{ fill?: string | CanvasGradient, stroke?: string, radius?: number, lineWidth?: number }} style
 */
export function fillRoundedRect(context, area, { fill, stroke, radius = 0, lineWidth = 2 }) {
  roundedRectPath(context, area, radius);
  if (fill !== undefined) {
    context.fillStyle = fill;
    context.fill();
  }
  if (stroke !== undefined) {
    context.lineWidth = lineWidth;
    context.strokeStyle = stroke;
    context.stroke();
  }
}

/**
 * Top-to-bottom gradient over `area`.
 * @param {CanvasRenderingContext2D} context
 * @param {Rect} area
 * @param {readonly (readonly [number, string])[]} stops `[offset, color]` pairs
 */
export function verticalGradient(context, area, stops) {
  const gradient = context.createLinearGradient(area.x, area.y, area.x, area.y + area.height);
  for (const [offset, color] of stops) {
    gradient.addColorStop(offset, color);
  }
  return gradient;
}

/**
 * Radial gradient centred at `center`, transparent at `radius`.
 * @param {CanvasRenderingContext2D} context
 * @param {{ x: number, y: number }} center
 * @param {number} radius
 * @param {readonly (readonly [number, string])[]} stops
 */
export function radialGradient(context, center, radius, stops) {
  const gradient = context.createRadialGradient(center.x, center.y, 0, center.x, center.y, Math.max(1, radius));
  for (const [offset, color] of stops) {
    gradient.addColorStop(offset, color);
  }
  return gradient;
}

/**
 * A soft coloured halo around a rounded rectangle: the frame is stroked
 * with a shadow, which reads as light bleeding from the edge.
 * @param {CanvasRenderingContext2D} context
 * @param {Rect} area
 * @param {{ color: string, radius: number, blur: number, lineWidth?: number, alpha?: number }} style
 */
export function glowRoundedRect(context, area, { color, radius, blur, lineWidth = 3, alpha = 1 }) {
  context.save();
  context.globalAlpha = Math.min(1, Math.max(0, alpha)) * context.globalAlpha;
  context.shadowColor = color;
  context.shadowBlur = blur;
  context.lineWidth = lineWidth;
  context.strokeStyle = color;
  roundedRectPath(context, area, radius);
  context.stroke();
  context.restore();
}

/**
 * A one-pixel light line along the top edge and a dark one along the bottom,
 * inside the rounded frame: the cheapest way to make a flat panel look raised.
 * @param {CanvasRenderingContext2D} context
 * @param {Rect} area
 * @param {{ light: string, dark: string, radius: number, inset?: number }} style
 */
export function bevelRoundedRect(context, area, { light, dark, radius, inset = 1.5 }) {
  const inner = { x: area.x + inset, y: area.y + inset, width: area.width - 2 * inset, height: area.height - 2 * inset };
  if (inner.width <= 0 || inner.height <= 0) {
    return;
  }
  context.save();
  roundedRectPath(context, area, radius);
  context.clip();
  context.lineWidth = 1;
  context.strokeStyle = light;
  context.beginPath();
  context.moveTo(inner.x + radius, inner.y);
  context.lineTo(inner.x + inner.width - radius, inner.y);
  context.stroke();
  context.strokeStyle = dark;
  context.beginPath();
  context.moveTo(inner.x + radius, inner.y + inner.height);
  context.lineTo(inner.x + inner.width - radius, inner.y + inner.height);
  context.stroke();
  context.restore();
}

/**
 * Darkens the edges of `area` so its content reads as sunk into the surface.
 * @param {CanvasRenderingContext2D} context
 * @param {Rect} area
 * @param {{ color: string, radius: number, depth: number }} style `color` is a hex token
 */
export function insetShadow(context, area, { color, radius, depth }) {
  context.save();
  roundedRectPath(context, area, radius);
  context.clip();
  context.lineWidth = depth * 2;
  context.strokeStyle = withAlpha(color, 0.55);
  context.shadowColor = withAlpha(color, 0.9);
  context.shadowBlur = depth * 2;
  roundedRectPath(context, { x: area.x - depth, y: area.y - depth, width: area.width + 2 * depth, height: area.height + 2 * depth }, radius + depth);
  context.stroke();
  context.restore();
}

/**
 * Draws a single line of text anchored inside `area`.
 * @param {CanvasRenderingContext2D} context
 * @param {string} text
 * @param {Rect} area
 * @param {{ font: string, color: string, align?: CanvasTextAlign, padding?: number }} style
 */
export function drawTextInRect(context, text, area, { font, color, align = "center", padding = 0 }) {
  context.font = font;
  context.fillStyle = color;
  context.textAlign = align;
  context.textBaseline = "middle";
  context.fillText(text, anchorFor(align, area, padding), area.y + area.height / 2);
}

/**
 * Text with a dark outline (and optional glow) so it stays readable over
 * art and gradients. Used for card names, floats and titles.
 * @param {CanvasRenderingContext2D} context
 * @param {string} text
 * @param {Rect} area
 * @param {{ font: string, color: string, outline: string, outlineWidth?: number, glow?: string, glowBlur?: number, align?: CanvasTextAlign, padding?: number }} style
 */
export function drawOutlinedText(context, text, area, style) {
  const { font, color, outline, outlineWidth = 3, glow, glowBlur = 0, align = "center", padding = 0 } = style;
  const x = anchorFor(align, area, padding);
  const y = area.y + area.height / 2;
  context.save();
  context.font = font;
  context.textAlign = align;
  context.textBaseline = "middle";
  context.lineJoin = "round";
  if (glow !== undefined && glowBlur > 0) {
    context.shadowColor = glow;
    context.shadowBlur = glowBlur;
  }
  context.lineWidth = outlineWidth;
  context.strokeStyle = outline;
  context.strokeText(text, x, y);
  context.shadowBlur = 0;
  context.fillStyle = color;
  context.fillText(text, x, y);
  context.restore();
}

/**
 * @param {CanvasTextAlign} align
 * @param {Rect} area
 * @param {number} padding
 */
export function anchorFor(align, area, padding) {
  if (align === "left") {
    return area.x + padding;
  }
  if (align === "right") {
    return area.x + area.width - padding;
  }
  return area.x + area.width / 2;
}

/**
 * Shrinks a rect by the same amount on every side (never below zero size).
 * @param {Rect} area
 * @param {number} amount
 * @returns {Rect}
 */
export function insetRect(area, amount) {
  return {
    x: area.x + amount,
    y: area.y + amount,
    width: Math.max(0, area.width - 2 * amount),
    height: Math.max(0, area.height - 2 * amount),
  };
}
