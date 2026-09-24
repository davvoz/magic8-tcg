import { bevelRoundedRect, fillRoundedRect, insetRect, verticalGradient } from "./drawing.js";
import { UiNode } from "./UiNode.js";
import { shade, withAlpha } from "../theme/color.js";

const RIM_INSET = 4;

/**
 * A bordered box; a container for other widgets. Drawn as a slab with a
 * vertical gradient, a bevel and a thin inner rim, in the theme's panel
 * colours by default; `fillKey`/`strokeKey` select other theme tokens
 * (`strokeKey: null` drops the border).
 */
export class Panel extends UiNode {
  /** @type {{ fillKey: string, strokeKey: string | null }} */
  style;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, fillKey?: string, strokeKey?: string | null }} [options]
   */
  constructor(options = {}) {
    super(options);
    this.style = { fillKey: options.fillKey ?? "panel", strokeKey: options.strokeKey === undefined ? "panelBorder" : options.strokeKey };
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const radius = theme.spacing.radius;
    const fill = theme.colors[this.style.fillKey] ?? theme.colors.panel;
    const stroke = this.style.strokeKey === null ? undefined : theme.colors[this.style.strokeKey];
    fillRoundedRect(context, area, { fill: verticalGradient(context, area, [[0, shade(fill, 0.06)], [1, shade(fill, -0.3)]]), stroke, radius, lineWidth: 1.5 });
    bevelRoundedRect(context, area, { light: withAlpha("#ffffff", 0.08), dark: withAlpha("#000000", 0.5), radius });
    fillRoundedRect(context, insetRect(area, RIM_INSET), { stroke: withAlpha(theme.colors.accent, 0.12), radius: Math.max(0, radius - RIM_INSET), lineWidth: 1 });
  }
}
