/**
 * The picture on the left of a Play screen's tile: a glow in the tile's
 * colour round a large emblem (online play, practice, the tutorial).
 * Drawing only; the challenge tile shows its opponent's portrait instead.
 */
import { drawIcon } from "../../ui/icons.js";
import { radialGradient, roundedRectPath } from "../../ui/drawing.js";
import { UiNode } from "../../ui/UiNode.js";
import { withAlpha } from "../../theme/color.js";

/** The emblem's share of the picture's shorter side. */
const EMBLEM_SHARE = 0.46;

export class TileArt extends UiNode {
  icon;
  /** The faction whose colours it takes (theme.colors.factions). */
  faction;

  /**
   * @param {{ id?: string, x: number, y: number, width: number, height: number, icon: string, faction: string }} options
   */
  constructor({ icon, faction, ...frame }) {
    super(frame);
    this.icon = icon;
    this.faction = faction;
    this.passthrough = true;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const { colors } = theme;
    const tones = colors.factions[this.faction] ?? colors.factions.neutral;
    const center = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
    context.save();
    roundedRectPath(context, area, theme.spacing.radius);
    context.clip();
    context.fillStyle = tones.dark;
    context.fillRect(area.x, area.y, area.width, area.height);
    context.fillStyle = radialGradient(context, center, Math.max(area.width, area.height) * 0.7, [[0, withAlpha(tones.base, 0.85)], [0.55, withAlpha(tones.base, 0.25)], [1, withAlpha(tones.dark, 0)]]);
    context.fillRect(area.x, area.y, area.width, area.height);
    context.restore();
    const size = Math.min(area.width, area.height) * EMBLEM_SHARE;
    drawIcon(context, this.icon, { x: center.x - size / 2, y: center.y - size / 2, size, color: tones.light });
  }
}
