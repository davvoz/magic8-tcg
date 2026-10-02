/**
 * Maps a logical resolution onto the actual canvas: uniform scale, centred,
 * DPR-aware. Owns the only logical↔device conversion in the codebase; input
 * and rendering both go through it. The design area always fits whole at
 * the origin; a window of another shape shows more around it (`bounds`,
 * with negative x or y), which scenes fill instead of leaving black bars.
 *
 * Two layout profiles:
 *
 *   wide     the design resolution the theme names (1600×900), fitted whole:
 *            desktops and tablets
 *   compact  a screen too small for it (a phone in landscape): the design
 *            area is COMPACT.height logical units tall (and COMPACT.minWidth
 *            to COMPACT.maxWidth wide, as the screen's shape allows), so the
 *            theme's type and touch sizes stay readable and tappable; scenes
 *            lay themselves out for it when `compact` is true
 *
 * The design area keeps clear of the screen's unsafe edges (a notch, a home
 * indicator) when their insets are given; `bounds` still covers them.
 */
import { rect } from "@magic8/engine/shared/geometry.js";

/** @typedef {"wide" | "compact"} LayoutProfile */
export const LayoutProfile = Object.freeze({ WIDE: "wide", COMPACT: "compact" });

/**
 * Below this scale the wide design would be too small to read and tap, and
 * the compact one is used. Its height, and the range of widths it may take.
 */
export const COMPACT = Object.freeze({ belowScale: 0.6, height: 400, minWidth: 760, maxWidth: 1100 });
/** Pixel density cap on compact screens: a phone at 3× pays nine times the fill rate of 1× for little to see. */
const COMPACT_MAX_DPR = 2;

/** @typedef {Readonly<{ top: number, right: number, bottom: number, left: number }>} Insets */
const NO_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

export class Viewport {
  #designWidth;
  #designHeight;
  #logicalWidth;
  #logicalHeight;
  /** @type {LayoutProfile} */
  #profile = LayoutProfile.WIDE;
  #scale = 1;
  #offsetX = 0;
  #offsetY = 0;
  #dpr = 1;
  #cssWidth = 0;
  #cssHeight = 0;
  /** @type {import("@magic8/engine/shared/geometry.js").Rect} */
  #visible;
  /** @type {import("@magic8/engine/shared/geometry.js").Rect} */
  #safe;

  /**
   * @param {{ logicalWidth: number, logicalHeight: number }} layout the wide design resolution
   */
  constructor({ logicalWidth, logicalHeight }) {
    this.#designWidth = logicalWidth;
    this.#designHeight = logicalHeight;
    this.#logicalWidth = logicalWidth;
    this.#logicalHeight = logicalHeight;
    this.#visible = rect(0, 0, logicalWidth, logicalHeight);
    this.#safe = this.#visible;
  }

  /** Width of the design area in the current profile. */
  get logicalWidth() {
    return this.#logicalWidth;
  }

  /** Height of the design area in the current profile. */
  get logicalHeight() {
    return this.#logicalHeight;
  }

  /** @returns {LayoutProfile} */
  get profile() {
    return this.#profile;
  }

  /** True on a small screen: scenes use their compact layouts. */
  get compact() {
    return this.#profile === LayoutProfile.COMPACT;
  }

  /**
   * Everything the canvas shows, in logical units: the design area plus
   * the margin the window's shape adds around it. The design area until the first resize.
   */
  get bounds() {
    return this.#visible;
  }

  /**
   * The part of `bounds` clear of the screen's unsafe edges: where a scene
   * that reaches to the edges (the match board) puts what must be seen and
   * tapped. The same as `bounds` on a screen without insets.
   */
  get safeBounds() {
    return this.#safe;
  }

  get scale() {
    return this.#scale;
  }

  get devicePixelRatio() {
    return this.#dpr;
  }

  /**
   * @param {{ cssWidth: number, cssHeight: number, devicePixelRatio?: number, insets?: Partial<Insets> }} size
   *   `insets`: the unsafe edges (CSS pixels) the design area keeps clear of
   */
  resize({ cssWidth, cssHeight, devicePixelRatio = 1, insets = NO_INSETS }) {
    this.#cssWidth = Math.max(1, cssWidth);
    this.#cssHeight = Math.max(1, cssHeight);
    const edges = clampInsets(insets, this.#cssWidth, this.#cssHeight);
    const safeWidth = Math.max(1, this.#cssWidth - edges.left - edges.right);
    const safeHeight = Math.max(1, this.#cssHeight - edges.top - edges.bottom);
    const wideScale = Math.min(safeWidth / this.#designWidth, safeHeight / this.#designHeight);
    if (wideScale >= COMPACT.belowScale) {
      this.#profile = LayoutProfile.WIDE;
      this.#logicalWidth = this.#designWidth;
      this.#logicalHeight = this.#designHeight;
      this.#scale = wideScale;
    } else {
      this.#profile = LayoutProfile.COMPACT;
      this.#scale = Math.min(safeHeight / COMPACT.height, safeWidth / COMPACT.minWidth);
      this.#logicalWidth = Math.round(Math.min(COMPACT.maxWidth, Math.max(COMPACT.minWidth, safeWidth / this.#scale)));
      this.#logicalHeight = COMPACT.height;
    }
    const maxDpr = this.compact ? COMPACT_MAX_DPR : 4;
    this.#dpr = Math.max(0.5, Math.min(maxDpr, devicePixelRatio));
    this.#offsetX = edges.left + (safeWidth - this.#logicalWidth * this.#scale) / 2;
    this.#offsetY = edges.top + (safeHeight - this.#logicalHeight * this.#scale) / 2;
    const corner = this.toLogical(0, 0);
    this.#visible = rect(corner.x, corner.y, this.#cssWidth / this.#scale, this.#cssHeight / this.#scale);
    const safeCorner = this.toLogical(edges.left, edges.top);
    this.#safe = rect(safeCorner.x, safeCorner.y, safeWidth / this.#scale, safeHeight / this.#scale);
  }

  /** Backing-store size the canvas should be given. */
  get deviceSize() {
    return Object.freeze({ width: Math.round(this.#cssWidth * this.#dpr), height: Math.round(this.#cssHeight * this.#dpr) });
  }

  /**
   * CSS-pixel coordinates relative to the canvas → logical coordinates.
   * @param {number} cssX
   * @param {number} cssY
   */
  toLogical(cssX, cssY) {
    return Object.freeze({ x: (cssX - this.#offsetX) / this.#scale, y: (cssY - this.#offsetY) / this.#scale });
  }

  /**
   * Logical → CSS-pixel coordinates relative to the canvas.
   * @param {number} x
   * @param {number} y
   */
  toCss(x, y) {
    return Object.freeze({ x: x * this.#scale + this.#offsetX, y: y * this.#scale + this.#offsetY });
  }

  /**
   * Sets the context transform so drawing in logical units lands on the
   * canvas at device resolution, the design area centred.
   * @param {CanvasRenderingContext2D} context
   */
  applyTransform(context) {
    const factor = this.#scale * this.#dpr;
    context.setTransform(factor, 0, 0, factor, this.#offsetX * this.#dpr, this.#offsetY * this.#dpr);
  }

  /** Where the design area starts and the canvas size, in CSS pixels; the render loop clears the whole canvas from it. */
  get letterbox() {
    return Object.freeze({ x: this.#offsetX, y: this.#offsetY, cssWidth: this.#cssWidth, cssHeight: this.#cssHeight });
  }
}

/**
 * Insets as finite, non-negative numbers that leave at least half the screen.
 * @param {Partial<Insets>} insets
 * @param {number} width
 * @param {number} height
 * @returns {Insets}
 */
function clampInsets(insets, width, height) {
  const edge = (value, limit) => (Number.isFinite(value) ? Math.min(limit / 4, Math.max(0, /** @type {number} */ (value))) : 0);
  return Object.freeze({ top: edge(insets.top, height), right: edge(insets.right, width), bottom: edge(insets.bottom, height), left: edge(insets.left, width) });
}
