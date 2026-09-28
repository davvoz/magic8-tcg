import { TablePiece } from "../images/TableArt.js";
import { bevelRoundedRect, drawImageCover, fillRoundedRect, insetRect, roundedRectPath, verticalGradient } from "./drawing.js";
import { UiNode } from "./UiNode.js";
import { shade, withAlpha } from "../theme/color.js";

const RIM_INSET = 4;
/** How much of the painted stone shows through a textured panel's colour, and how dark its foot gets. */
const STONE = Object.freeze({ alpha: 0.45, footShade: 0.55 });

/**
 * A bordered box; a container for other widgets. Drawn as a slab with a
 * vertical gradient, a bevel and a thin inner rim, in the theme's panel
 * colours by default; `fillKey`/`strokeKey` select other theme tokens
 * (`strokeKey: null` drops the border). A `textured` panel is cut from the
 * painted stone (Theme.tableArt) once its image is ready.
 */
export class Panel extends UiNode {
  /** @type {{ fillKey: string, strokeKey: string | null, textured: boolean }} */
  style;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, fillKey?: string, strokeKey?: string | null, textured?: boolean }} [options]
   */
  constructor(options = {}) {
    super(options);
    this.style = { fillKey: options.fillKey ?? "panel", strokeKey: options.strokeKey === undefined ? "panelBorder" : options.strokeKey, textured: options.textured ?? false };
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
    if (this.style.textured) {
      paintStone(context, theme, area, radius);
      fillRoundedRect(context, area, { stroke, radius, lineWidth: 1.5 });
    }
    bevelRoundedRect(context, area, { light: withAlpha("#ffffff", 0.08), dark: withAlpha("#000000", 0.5), radius });
    fillRoundedRect(context, insetRect(area, RIM_INSET), { stroke: withAlpha(theme.colors.accent, 0.12), radius: Math.max(0, radius - RIM_INSET), lineWidth: 1 });
  }
}

/**
 * Lays the painted stone over an area already filled with its colour,
 * darkening towards the foot so text stays readable. Nothing while the
 * image is not ready: the colour alone shows.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {import("@magic8/engine/shared/geometry.js").Rect} area
 * @param {number} radius
 */
export function paintStone(context, theme, area, radius) {
  const stone = theme.tableArt?.imageFor(TablePiece.PANEL) ?? null;
  if (stone === null) {
    return;
  }
  context.save();
  roundedRectPath(context, area, radius);
  context.clip();
  context.globalAlpha = STONE.alpha;
  drawImageCover(context, stone, area);
  context.globalAlpha = 1;
  context.fillStyle = verticalGradient(context, area, [[0, withAlpha(theme.colors.panelDark, 0)], [1, withAlpha(theme.colors.panelDark, STONE.footShade)]]);
  context.fillRect(area.x, area.y, area.width, area.height);
  context.restore();
}
