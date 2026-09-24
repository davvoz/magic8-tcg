/**
 * Procedural shapes used by cards and HUD: regular polygons, gems, stars
 * and the small pictograms for attack, health, resources, library and
 * graveyard. Everything is a path in logical units; callers set fill and
 * stroke. Drawn, not typed: the game never relies on symbol glyphs.
 */

/** @typedef {{ x: number, y: number }} Point */

/**
 * Path of a regular polygon.
 * @param {CanvasRenderingContext2D} context
 * @param {Point} center
 * @param {number} radius
 * @param {{ sides: number, rotation?: number }} shape
 */
export function polygonPath(context, center, radius, { sides, rotation = -Math.PI / 2 }) {
  const count = Math.max(3, Math.floor(sides));
  context.beginPath();
  for (let index = 0; index < count; index += 1) {
    const angle = rotation + (index / count) * Math.PI * 2;
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }
  context.closePath();
}

/**
 * Path of a star with `points` tips.
 * @param {CanvasRenderingContext2D} context
 * @param {Point} center
 * @param {number} radius outer radius
 * @param {{ points: number, innerRatio?: number, rotation?: number }} shape
 */
export function starPath(context, center, radius, { points, innerRatio = 0.45, rotation = -Math.PI / 2 }) {
  const count = Math.max(3, Math.floor(points));
  context.beginPath();
  for (let index = 0; index < count * 2; index += 1) {
    const angle = rotation + (index / (count * 2)) * Math.PI * 2;
    const distance = index % 2 === 0 ? radius : radius * innerRatio;
    const x = center.x + Math.cos(angle) * distance;
    const y = center.y + Math.sin(angle) * distance;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }
  context.closePath();
}

/**
 * A faceted gem: a filled polygon with a light rim and a specular highlight.
 * @param {CanvasRenderingContext2D} context
 * @param {Point} center
 * @param {number} radius
 * @param {{ fill: string | CanvasGradient, rim: string, highlight: string, sides?: number, rimWidth?: number }} style
 */
export function drawGem(context, center, radius, { fill, rim, highlight, sides = 6, rimWidth = 2 }) {
  context.save();
  polygonPath(context, center, radius, { sides });
  context.fillStyle = fill;
  context.fill();
  context.lineWidth = rimWidth;
  context.strokeStyle = rim;
  context.stroke();
  polygonPath(context, { x: center.x - radius * 0.22, y: center.y - radius * 0.3 }, radius * 0.38, { sides, rotation: -Math.PI / 2 + 0.4 });
  context.fillStyle = highlight;
  context.fill();
  context.restore();
}

/**
 * A round orb with a specular spot; lit or dim.
 * @param {CanvasRenderingContext2D} context
 * @param {Point} center
 * @param {number} radius
 * @param {{ fill: string | CanvasGradient, rim: string, highlight: string }} style
 */
export function drawOrb(context, center, radius, { fill, rim, highlight }) {
  context.save();
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();
  context.lineWidth = 1.5;
  context.strokeStyle = rim;
  context.stroke();
  context.beginPath();
  context.arc(center.x - radius * 0.3, center.y - radius * 0.35, radius * 0.28, 0, Math.PI * 2);
  context.fillStyle = highlight;
  context.fill();
  context.restore();
}

/**
 * Sword pictogram (attack): blade pointing up-right, crossguard, grip.
 * @param {CanvasRenderingContext2D} context
 * @param {Point} center
 * @param {number} size overall span
 * @param {{ blade: string, hilt: string }} style
 */
export function drawSwordIcon(context, center, size, { blade, hilt }) {
  const half = size / 2;
  context.save();
  context.translate(center.x, center.y);
  context.rotate(Math.PI / 4);
  context.lineCap = "round";
  context.strokeStyle = blade;
  context.lineWidth = Math.max(1.5, size * 0.16);
  context.beginPath();
  context.moveTo(0, half);
  context.lineTo(0, -half * 0.75);
  context.stroke();
  context.beginPath();
  context.moveTo(0, -half);
  context.lineTo(-size * 0.12, -half * 0.7);
  context.lineTo(size * 0.12, -half * 0.7);
  context.closePath();
  context.fillStyle = blade;
  context.fill();
  context.strokeStyle = hilt;
  context.lineWidth = Math.max(1.5, size * 0.18);
  context.beginPath();
  context.moveTo(-half * 0.45, half * 0.35);
  context.lineTo(half * 0.45, half * 0.35);
  context.stroke();
  context.restore();
}

/**
 * Shield pictogram (health).
 * @param {CanvasRenderingContext2D} context
 * @param {Point} center
 * @param {number} size overall span
 * @param {{ fill: string, rim: string }} style
 */
export function drawShieldIcon(context, center, size, { fill, rim }) {
  const half = size / 2;
  context.save();
  context.translate(center.x, center.y);
  context.beginPath();
  context.moveTo(0, -half);
  context.lineTo(half * 0.85, -half * 0.6);
  context.quadraticCurveTo(half * 0.9, half * 0.35, 0, half);
  context.quadraticCurveTo(-half * 0.9, half * 0.35, -half * 0.85, -half * 0.6);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.lineWidth = Math.max(1, size * 0.1);
  context.strokeStyle = rim;
  context.stroke();
  context.restore();
}

/**
 * A short stack of card outlines (library / graveyard).
 * @param {CanvasRenderingContext2D} context
 * @param {import("@magic8/engine/shared/geometry.js").Rect} area
 * @param {{ fill: string, stroke: string, layers?: number }} style
 */
export function drawCardStackIcon(context, area, { fill, stroke, layers = 3 }) {
  const count = Math.max(1, Math.min(6, Math.floor(layers)));
  const step = Math.max(1, area.height * 0.08);
  const cardHeight = area.height - step * (count - 1);
  const cardWidth = area.width - step * (count - 1);
  context.save();
  context.lineWidth = 1.5;
  for (let index = count - 1; index >= 0; index -= 1) {
    const x = area.x + step * index;
    const y = area.y + area.height - cardHeight - step * index;
    context.beginPath();
    context.rect(x, y, cardWidth, cardHeight);
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = stroke;
    context.stroke();
  }
  context.restore();
}

/**
 * Arrow from `from` to `to` with a filled head.
 * @param {CanvasRenderingContext2D} context
 * @param {Point} from
 * @param {Point} to
 * @param {{ color: string, width: number, headSize?: number }} style
 */
export function drawArrow(context, from, to, { color, width, headSize = 14 }) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const shaftEnd = { x: to.x - Math.cos(angle) * headSize * 0.6, y: to.y - Math.sin(angle) * headSize * 0.6 };
  context.save();
  context.lineCap = "round";
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(shaftEnd.x, shaftEnd.y);
  context.stroke();
  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - Math.cos(angle - Math.PI / 6) * headSize, to.y - Math.sin(angle - Math.PI / 6) * headSize);
  context.lineTo(to.x - Math.cos(angle + Math.PI / 6) * headSize, to.y - Math.sin(angle + Math.PI / 6) * headSize);
  context.closePath();
  context.fill();
  context.restore();
}

/**
 * Check mark inside a box, for selected rows.
 * @param {CanvasRenderingContext2D} context
 * @param {Point} center
 * @param {number} size
 * @param {{ color: string }} style
 */
export function drawCheckIcon(context, center, size, { color }) {
  const half = size / 2;
  context.save();
  context.strokeStyle = color;
  context.lineWidth = Math.max(2, size * 0.18);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(center.x - half * 0.7, center.y);
  context.lineTo(center.x - half * 0.15, center.y + half * 0.55);
  context.lineTo(center.x + half * 0.75, center.y - half * 0.55);
  context.stroke();
  context.restore();
}
