/** Axis-aligned rectangles and points in logical coordinates. Plain data, no classes. */

/**
 * @typedef {Readonly<{ x: number, y: number, width: number, height: number }>} Rect
 * @typedef {Readonly<{ x: number, y: number }>} Point
 */

/**
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @returns {Rect}
 */
export function rect(x, y, width, height) {
  return Object.freeze({ x, y, width, height });
}

/**
 * @param {Rect} area
 * @param {Point} point
 */
export function containsPoint(area, point) {
  return point.x >= area.x && point.x < area.x + area.width && point.y >= area.y && point.y < area.y + area.height;
}
