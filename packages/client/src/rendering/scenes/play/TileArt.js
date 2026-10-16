/**
 * The picture on the left of a Play screen's tile (online play, practice,
 * the tutorial): its painting (Theme.uiArt), whole, never cropped: as large
 * as the frame allows, centred in it, and rimmed in the tile's colour (a
 * frame of the painting's shape is filled by it); until the painting is
 * ready, a glow in that colour round a large emblem. Drawing only; the challenge tile shows a
 * character's portrait instead.
 */
import { drawIcon } from "../../ui/icons.js";
import { radialGradient, roundedRectPath } from "../../ui/drawing.js";
import { UiNode } from "../../ui/UiNode.js";
import { withAlpha } from "../../theme/color.js";

/** The emblem's share of the picture's shorter side. */
const EMBLEM_SHARE = 0.46;

export class TileArt extends UiNode {
  /** The painting (a UiPiece). */
  piece;
  /** The emblem drawn until the painting is ready. */
  icon;
  /** The faction whose colours it takes (theme.colors.factions). */
  faction;

  /**
   * @param {{ id?: string, x: number, y: number, width: number, height: number, piece: string, icon: string, faction: string }} options
   */
  constructor({ piece, icon, faction, ...frame }) {
    super(frame);
    this.piece = piece;
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
    const painting = theme.uiArt?.imageFor(this.piece) ?? null;
    if (painting !== null) {
      const shown = containedRect(painting, area);
      context.save();
      roundedRectPath(context, shown, theme.spacing.radius);
      context.clip();
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(painting.source, shown.x, shown.y, shown.width, shown.height);
      context.restore();
      context.save();
      roundedRectPath(context, shown, theme.spacing.radius);
      context.lineWidth = 1.5;
      context.strokeStyle = withAlpha(tones.light, 0.55);
      context.stroke();
      context.restore();
      return;
    }
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

/**
 * The largest box of the image's shape inside `area`, centred in it.
 * @param {{ width: number, height: number }} image
 * @param {{ x: number, y: number, width: number, height: number }} area
 */
function containedRect(image, area) {
  const scale = Math.min(area.width / image.width, area.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height };
}
