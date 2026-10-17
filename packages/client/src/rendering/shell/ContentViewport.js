/**
 * The screen as a scene inside the navigation shell sees it: its design
 * area is the shell's content area (ShellLayout), with the origin at that
 * area's top-left corner, so a scene lays itself out in `logicalWidth` ×
 * `logicalHeight` exactly as it would on a whole screen. The scene manager
 * moves what the scene draws, and the pointer, by `origin`; the shell
 * itself sits at negative coordinates, left of and above the content.
 *
 * Everything else is the screen's (the Viewport): the layout profile, the
 * scale, the pixel density, and the canvas around the design area
 * (`bounds`), here in content coordinates.
 */
import { rect } from "@magic8/engine/shared/geometry.js";
import { shellLayout } from "./ShellLayout.js";

export class ContentViewport {
  #screen;

  /** @param {import("../canvas/Viewport.js").Viewport} screen the whole screen's viewport */
  constructor(screen) {
    this.#screen = screen;
  }

  /** The whole screen's viewport, for what the shell lays out around the content. */
  get screen() {
    return this.#screen;
  }

  /** The shell's layout on the screen in use. */
  get shell() {
    return shellLayout(this.#screen);
  }

  /** Where the content area starts, in the screen's design-area coordinates. */
  get origin() {
    const { content } = this.shell;
    return Object.freeze({ x: content.x, y: content.y });
  }

  get logicalWidth() {
    return this.shell.content.width;
  }

  get logicalHeight() {
    return this.shell.content.height;
  }

  get profile() {
    return this.#screen.profile;
  }

  get compact() {
    return this.#screen.compact;
  }

  get scale() {
    return this.#screen.scale;
  }

  get devicePixelRatio() {
    return this.#screen.devicePixelRatio;
  }

  /** Everything the canvas shows, in content coordinates. */
  get bounds() {
    return this.#shift(this.#screen.bounds);
  }

  /** The part of `bounds` clear of the screen's unsafe edges, in content coordinates. */
  get safeBounds() {
    return this.#shift(this.#screen.safeBounds);
  }

  /** The whole design area (shell included), in content coordinates: where dialogs are centred. */
  get designArea() {
    return this.#shift(rect(0, 0, this.#screen.logicalWidth, this.#screen.logicalHeight));
  }

  /**
   * CSS-pixel coordinates relative to the canvas → content coordinates.
   * @param {number} cssX
   * @param {number} cssY
   */
  toLogical(cssX, cssY) {
    const point = this.#screen.toLogical(cssX, cssY);
    const { x, y } = this.origin;
    return Object.freeze({ x: point.x - x, y: point.y - y });
  }

  /**
   * Content coordinates → CSS-pixel coordinates relative to the canvas.
   * @param {number} x
   * @param {number} y
   */
  toCss(x, y) {
    const origin = this.origin;
    return this.#screen.toCss(x + origin.x, y + origin.y);
  }

  /** @param {import("@magic8/engine/shared/geometry.js").Rect} area */
  #shift(area) {
    const { x, y } = this.origin;
    return rect(area.x - x, area.y - y, area.width, area.height);
  }
}
