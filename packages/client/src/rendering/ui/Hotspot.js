/**
 * An invisible tappable area laid over something drawn (a card strip on a
 * phone, where there is no room for a button beside it): a tap, click or
 * Enter calls `onActivate`. It draws nothing but the focus ring.
 */
import { fillRoundedRect } from "./drawing.js";
import { UiNode } from "./UiNode.js";

export class Hotspot extends UiNode {
  /** @type {() => void} */
  onActivate;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, enabled?: boolean, onActivate: () => void }} options
   */
  constructor(options) {
    super(options);
    this.onActivate = options.onActivate;
    this.interactive = true;
    this.focusable = true;
  }

  activate() {
    if (this.isEffectivelyEnabled) {
      this.onActivate();
    }
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    if (this.focused || this.pressed) {
      fillRoundedRect(context, this.bounds, { stroke: theme.colors.focus, radius: theme.spacing.radius, lineWidth: 2 });
    }
  }
}
