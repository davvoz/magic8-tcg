/**
 * A vertically scrolling, clipped container. Callers add rows to `content`
 * (a plain UiNode whose `y` is the negative scroll offset) and set
 * `contentHeight`; hit-testing and absolute bounds then work unchanged
 * because rows are ordinary children positioned relative to `content`.
 *
 * Scrolling is driven by the scene: wheel over the list, drag inside it,
 * and `revealDescendant` when keyboard focus lands on a hidden row.
 */
import { fillRoundedRect, roundedRectPath } from "./drawing.js";
import { UiNode } from "./UiNode.js";
import { withAlpha } from "../theme/color.js";

const SCROLLBAR_WIDTH = 6;
const SCROLLBAR_INSET = 4;
const MIN_THUMB_HEIGHT = 24;
/** Horizontal room rows should leave free so the scrollbar never covers their right edge. */
export const SCROLL_GUTTER = SCROLLBAR_WIDTH + 2 * SCROLLBAR_INSET + 2;

export class ScrollList extends UiNode {
  /** Container for rows; its `y` is `-scrollY` and its height the content height. @type {UiNode} */
  content;
  /** @type {{ fillKey: string | null, strokeKey: string | null }} */
  style;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, fillKey?: string | null, strokeKey?: string | null }} [options]
   */
  constructor(options = {}) {
    super(options);
    this.style = { fillKey: options.fillKey ?? null, strokeKey: options.strokeKey ?? null };
    this.content = super.add(new UiNode({ id: `${this.id}.content`, width: this.width }));
  }

  /** Total height of the rows, set by whoever fills `content`; rows below it are not hit-testable. */
  get contentHeight() {
    return this.content.height;
  }

  set contentHeight(value) {
    this.content.height = Math.max(0, value);
  }

  /** Width available to rows beside the scrollbar gutter. */
  get rowWidth() {
    return Math.max(0, this.width - SCROLL_GUTTER);
  }

  get scrollY() {
    return 0 - this.content.y; // subtraction, so an unscrolled list reports 0 rather than -0
  }

  get maxScrollY() {
    return Math.max(0, this.contentHeight - this.height);
  }

  /**
   * Scrolls to an absolute offset, clamped to the content.
   * @param {number} offset
   * @returns {boolean} whether the offset changed
   */
  scrollTo(offset) {
    const clamped = Math.min(this.maxScrollY, Math.max(0, offset));
    if (clamped === this.scrollY) {
      return false;
    }
    this.content.y = 0 - clamped;

    return true;
  }

  /**
   * @param {number} delta positive scrolls down
   * @returns {boolean} whether the offset changed
   */
  scrollBy(delta) {
    return this.scrollTo(this.scrollY + delta);
  }

  /** Rows go into `content`, never directly into the list. */
  add(child) {
    return this.content.add(child);
  }

  clearRows() {
    this.content.clear();
    this.content.height = 0;
    this.content.y = 0;
  }

  /** @param {UiNode} node */
  revealDescendant(node) {
    const top = node.bounds.y - this.bounds.y + this.scrollY;
    const bottom = top + node.height;
    if (top < this.scrollY) {
      this.scrollTo(top);
    } else if (bottom > this.scrollY + this.height) {
      this.scrollTo(bottom - this.height);
    }
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  draw(context, theme) {
    if (!this.visible) {
      return;
    }
    const area = this.bounds;
    if (this.style.fillKey !== null || this.style.strokeKey !== null) {
      fillRoundedRect(context, area, {
        fill: this.style.fillKey === null ? undefined : theme.colors[this.style.fillKey],
        stroke: this.style.strokeKey === null ? undefined : theme.colors[this.style.strokeKey],
        radius: theme.spacing.radius,
      });
    }
    context.save();
    roundedRectPath(context, area, theme.spacing.radius);
    context.clip();
    this.content.draw(context, theme);
    context.restore();
    this.#drawScrollbar(context, theme);
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  #drawScrollbar(context, theme) {
    if (this.maxScrollY === 0) {
      return;
    }
    const area = this.bounds;
    const trackHeight = area.height - 2 * SCROLLBAR_INSET;
    const thumbHeight = Math.max(MIN_THUMB_HEIGHT, (this.height / this.contentHeight) * trackHeight);
    const thumbY = area.y + SCROLLBAR_INSET + (this.scrollY / this.maxScrollY) * (trackHeight - thumbHeight);
    const x = area.x + area.width - SCROLLBAR_WIDTH - SCROLLBAR_INSET;
    fillRoundedRect(context, { x, y: area.y + SCROLLBAR_INSET, width: SCROLLBAR_WIDTH, height: trackHeight }, { fill: withAlpha(theme.colors.letterbox, 0.35), radius: SCROLLBAR_WIDTH / 2 });
    fillRoundedRect(context, { x, y: thumbY, width: SCROLLBAR_WIDTH, height: thumbHeight }, { fill: theme.colors.accent, radius: SCROLLBAR_WIDTH / 2 });
  }
}
