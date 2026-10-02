import { TablePiece } from "../images/TableArt.js";
import { inPixels, UiPiece } from "../images/UiArt.js";
import { bevelRoundedRect, drawImageCover, fillRoundedRect, glowRoundedRect, insetRect, roundedRectPath, verticalGradient } from "./drawing.js";
import { UiNode } from "./UiNode.js";
import { shade, withAlpha } from "../theme/color.js";

const RIM_INSET = 4;
/** A lit panel: its halo, and how much of the light tints its face. */
const LIT = Object.freeze({ blur: 18, lineWidth: 2.5, tint: 0.14 });
/** How much a clickable panel brightens under the pointer. */
const HOVER_WASH = 0.06;
/** How much of the painted stone shows through a textured panel's colour, and how dark its foot gets. */
const STONE = Object.freeze({ alpha: 0.45, footShade: 0.55 });
/**
 * The painted corners: where their lines run (from the panel's edge), their
 * largest and smallest scale, how far along each side they may reach (a
 * fraction of it) and how strongly they show. Kept small: titles sit in the
 * top-left corner.
 */
const CORNER = Object.freeze({ inset: 6, maxScale: 0.12, minScale: 0.07, reach: 0.42, alpha: 0.85 });
/** Top-left, top-right, bottom-left, bottom-right. */
const CORNER_FLIPS = Object.freeze([[1, 1], [-1, 1], [1, -1], [-1, -1]]);
/**
 * How far a panel's content keeps from its sides so that none of it sits on
 * the painted corners: at CORNER.maxScale their scrolls reach about 34
 * units along each side, thinning towards the rim (measured on the corner
 * image: regenerating it means measuring it again).
 */
export const PANEL_INSET = 34;

/**
 * A bordered box; a container for other widgets. Drawn as a slab with a
 * vertical gradient, a bevel and a thin inner rim, in the theme's panel
 * colours by default; `fillKey`/`strokeKey` select other theme tokens
 * (`strokeKey: null` drops the border). A `textured` panel is cut from the
 * painted stone (Theme.tableArt) once its image is ready; any other panel
 * large enough is dressed with the painted gold corners (Theme.uiArt).
 * `glowKey` lights it: a halo and a tint in that theme colour (something
 * new). With `onActivate` the whole panel is clickable (a list entry); the
 * widgets on it still take their own clicks.
 */
export class Panel extends UiNode {
  /** @type {{ fillKey: string, strokeKey: string | null, textured: boolean, glowKey: string | null }} */
  style;
  /** @type {(() => void) | null} */
  onActivate;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, fillKey?: string, strokeKey?: string | null, textured?: boolean, glowKey?: string | null, onActivate?: (() => void) | null }} [options]
   */
  constructor(options = {}) {
    super(options);
    this.style = { fillKey: options.fillKey ?? "panel", strokeKey: options.strokeKey === undefined ? "panelBorder" : options.strokeKey, textured: options.textured ?? false, glowKey: options.glowKey ?? null };
    this.onActivate = options.onActivate ?? null;
    this.interactive = this.onActivate !== null;
  }

  activate() {
    if (this.onActivate !== null && this.isEffectivelyEnabled && this.isEffectivelyVisible) {
      this.onActivate();
    }
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const radius = theme.spacing.radius;
    const fill = theme.colors[this.style.fillKey] ?? theme.colors.panel;
    const glow = this.style.glowKey === null ? undefined : theme.colors[this.style.glowKey];
    const border = this.style.strokeKey === null ? undefined : theme.colors[this.style.strokeKey];
    const stroke = glow ?? border;
    if (glow !== undefined) {
      glowRoundedRect(context, area, { color: glow, radius, blur: LIT.blur, lineWidth: LIT.lineWidth });
    }
    fillRoundedRect(context, area, { fill: verticalGradient(context, area, [[0, shade(fill, 0.06)], [1, shade(fill, -0.3)]]), stroke, radius, lineWidth: 1.5 });
    if (this.style.textured) {
      paintStone(context, theme, area, radius);
      fillRoundedRect(context, area, { stroke, radius, lineWidth: 1.5 });
    }
    this.#paintWash(context, area, radius, glow);
    bevelRoundedRect(context, area, { light: withAlpha("#ffffff", 0.08), dark: withAlpha("#000000", 0.5), radius });
    fillRoundedRect(context, insetRect(area, RIM_INSET), { stroke: withAlpha(theme.colors.accent, 0.12), radius: Math.max(0, radius - RIM_INSET), lineWidth: 1 });
    if (!this.style.textured) {
      paintCorners(context, theme, area);
    }
  }

  /**
   * The light over a lit panel's face, brighter under the pointer; a plain
   * clickable panel only brightens under the pointer.
   * @param {CanvasRenderingContext2D} context
   * @param {import("@magic8/engine/shared/geometry.js").Rect} area
   * @param {number} radius
   * @param {string | undefined} glow
   */
  #paintWash(context, area, radius, glow) {
    const hover = this.interactive && this.hovered ? HOVER_WASH : 0;
    if (glow === undefined && hover === 0) {
      return;
    }
    fillRoundedRect(context, area, { fill: glow === undefined ? withAlpha("#ffffff", hover) : withAlpha(glow, LIT.tint + hover), radius });
  }
}

/**
 * The painted gold corner (Theme.uiArt) in each corner of a large panel,
 * mirrored, its lines laid along the rim. Sized to the panel, never beyond
 * CORNER.maxScale nor so far that opposite corners meet; a panel too small
 * for a legible corner gets none, and so does every panel while the image
 * is not ready.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {import("@magic8/engine/shared/geometry.js").Rect} area
 */
function paintCorners(context, theme, area) {
  const art = theme.uiArt;
  const image = art?.imageFor(UiPiece.CORNER) ?? null;
  if (art === undefined || image === null) {
    return;
  }
  const extent = inPixels(art.layout.corner.extent, image);
  const lines = { x: art.layout.corner.lines.x * image.width, y: art.layout.corner.lines.y * image.height };
  const reach = { x: extent.x + extent.width - lines.x, y: extent.y + extent.height - lines.y };
  const scale = Math.min(CORNER.maxScale, (CORNER.reach * area.width) / reach.x, (CORNER.reach * area.height) / reach.y);
  if (scale < CORNER.minScale) {
    return;
  }
  context.save();
  context.globalCompositeOperation = "screen";
  context.globalAlpha = CORNER.alpha;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  for (const [flipX, flipY] of CORNER_FLIPS) {
    context.save();
    context.translate(flipX > 0 ? area.x + CORNER.inset : area.x + area.width - CORNER.inset, flipY > 0 ? area.y + CORNER.inset : area.y + area.height - CORNER.inset);
    context.scale(flipX * scale, flipY * scale);
    context.drawImage(image.source, extent.x, extent.y, extent.width, extent.height, extent.x - lines.x, extent.y - lines.y, extent.width, extent.height);
    context.restore();
  }
  context.restore();
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
