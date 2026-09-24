/**
 * Pure colour arithmetic over the theme's `#rrggbb` tokens, so draw code can
 * derive highlights, shadows and translucent variants from a small palette
 * instead of the theme listing every shade. Inputs are theme tokens (already
 * validated); malformed strings fall back to black rather than throwing in a
 * frame.
 */

const HEX_PATTERN = /^#([0-9a-fA-F]{6})$/;
const CHANNEL_MAX = 255;

/** @typedef {Readonly<{ r: number, g: number, b: number }>} Rgb */

/**
 * @param {string} hex `#rrggbb`
 * @returns {Rgb}
 */
export function hexToRgb(hex) {
  const match = HEX_PATTERN.exec(hex);
  if (match === null) {
    return Object.freeze({ r: 0, g: 0, b: 0 });
  }
  const value = Number.parseInt(match[1], 16);
  return Object.freeze({ r: (value >> 16) & CHANNEL_MAX, g: (value >> 8) & CHANNEL_MAX, b: value & CHANNEL_MAX });
}

/**
 * @param {Rgb} rgb
 * @returns {string} `#rrggbb`
 */
export function rgbToHex({ r, g, b }) {
  const pack = (channel) => clampChannel(channel).toString(16).padStart(2, "0");
  return `#${pack(r)}${pack(g)}${pack(b)}`;
}

/**
 * CSS `rgba()` for a hex token at the given opacity.
 * @param {string} hex
 * @param {number} alpha 0..1
 */
export function withAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clampUnit(alpha)})`;
}

/**
 * Linear blend of two colours; `t = 0` is `from`, `t = 1` is `to`.
 * @param {string} from
 * @param {string} to
 * @param {number} t
 */
export function mix(from, to, t) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const weight = clampUnit(t);
  return rgbToHex({ r: a.r + (b.r - a.r) * weight, g: a.g + (b.g - a.g) * weight, b: a.b + (b.b - a.b) * weight });
}

/**
 * Lightens (positive) or darkens (negative) a colour toward white or black.
 * @param {string} hex
 * @param {number} amount -1..1
 */
export function shade(hex, amount) {
  const target = amount >= 0 ? "#ffffff" : "#000000";
  return mix(hex, target, Math.abs(amount));
}

/** @param {number} value */
function clampUnit(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/** @param {number} value */
function clampChannel(value) {
  return Math.round(Math.min(CHANNEL_MAX, Math.max(0, Number.isFinite(value) ? value : 0)));
}
