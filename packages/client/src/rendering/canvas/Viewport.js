/**
 * Maps a fixed logical resolution (e.g. 1600×900) onto the actual canvas:
 * uniform scale, centred, DPR-aware. Owns the only logical↔device
 * conversion in the codebase; input and rendering both go through it.
 * The design area always fits whole at the origin; a window of another
 * shape shows more around it (`bounds`, with negative x or y), which
 * scenes fill instead of leaving black bars.
 */
import { rect } from "@magic8/engine/shared/geometry.js";

export class Viewport {
  #logicalWidth;
  #logicalHeight;
  #scale = 1;
  #offsetX = 0;
  #offsetY = 0;
  #dpr = 1;
  #cssWidth = 0;
  #cssHeight = 0;
  /** @type {import("@magic8/engine/shared/geometry.js").Rect} */
  #visible;

  /**
   * @param {{ logicalWidth: number, logicalHeight: number }} layout
   */
  constructor({ logicalWidth, logicalHeight }) {
    this.#logicalWidth = logicalWidth;
    this.#logicalHeight = logicalHeight;
    this.#visible = rect(0, 0, logicalWidth, logicalHeight);
  }

  get logicalWidth() {
    return this.#logicalWidth;
  }

  get logicalHeight() {
    return this.#logicalHeight;
  }

  /**
   * Everything the canvas shows, in logical units: the design area plus
   * the margin the window's shape adds on two opposite sides (equal on
   * both, so the design area stays centred). The design area until the first resize.
   */
  get bounds() {
    return this.#visible;
  }

  get scale() {
    return this.#scale;
  }

  get devicePixelRatio() {
    return this.#dpr;
  }

  /**
   * @param {{ cssWidth: number, cssHeight: number, devicePixelRatio?: number }} size
   */
  resize({ cssWidth, cssHeight, devicePixelRatio = 1 }) {
    this.#cssWidth = Math.max(1, cssWidth);
    this.#cssHeight = Math.max(1, cssHeight);
    this.#dpr = Math.max(0.5, Math.min(4, devicePixelRatio));
    this.#scale = Math.min(this.#cssWidth / this.#logicalWidth, this.#cssHeight / this.#logicalHeight);
    this.#offsetX = (this.#cssWidth - this.#logicalWidth * this.#scale) / 2;
    this.#offsetY = (this.#cssHeight - this.#logicalHeight * this.#scale) / 2;
    const corner = this.toLogical(0, 0);
    this.#visible = rect(corner.x, corner.y, this.#cssWidth / this.#scale, this.#cssHeight / this.#scale);
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
