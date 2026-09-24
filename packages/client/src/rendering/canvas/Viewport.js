/**
 * Maps a fixed logical resolution (e.g. 1600×900) onto the actual canvas:
 * uniform scale, centred with letterboxing, DPR-aware. Owns the only
 * logical↔device conversion in the codebase; input and rendering both go
 * through it.
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

  /**
   * @param {{ logicalWidth: number, logicalHeight: number }} layout
   */
  constructor({ logicalWidth, logicalHeight }) {
    this.#logicalWidth = logicalWidth;
    this.#logicalHeight = logicalHeight;
  }

  get logicalWidth() {
    return this.#logicalWidth;
  }

  get logicalHeight() {
    return this.#logicalHeight;
  }

  /** Whole logical area as a rect at the origin. */
  get bounds() {
    return rect(0, 0, this.#logicalWidth, this.#logicalHeight);
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
   * Sets the context transform so drawing in logical units lands in the
   * letterboxed area at device resolution.
   * @param {CanvasRenderingContext2D} context
   */
  applyTransform(context) {
    const factor = this.#scale * this.#dpr;
    context.setTransform(factor, 0, 0, factor, this.#offsetX * this.#dpr, this.#offsetY * this.#dpr);
  }

  /** Letterbox bars in CSS pixels (relative to the canvas), for painting the surround. */
  get letterbox() {
    return Object.freeze({ x: this.#offsetX, y: this.#offsetY, cssWidth: this.#cssWidth, cssHeight: this.#cssHeight });
  }
}
