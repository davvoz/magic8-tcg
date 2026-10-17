/**
 * The picture on the left of a Play screen's tile (online play, practice,
 * the tutorial): its painting (Theme.uiArt), whole, never cropped: as large
 * as the frame allows, centred in it over a glow in the tile's colour (a
 * frame of the painting's shape, PAINTING_ASPECT, is filled by it), the
 * frame rimmed in that colour, so pictures side by side line up whatever
 * their shape; until the painting is ready, a large emblem in the glow. Drawing only; the challenge tile shows a
 * character's portrait instead. The painting may be one of the table's
 * (Theme.tableArt: the card back), and the whole picture may be dimmed (a
 * locked section on a phone's Home). With `cover`, the painting fills
 * the frame instead, cropped as little as it takes (Home's online card,
 * whose box is the challenge portrait's beside it).
 */
import { drawIcon } from "../../ui/icons.js";
import { drawImageCover, radialGradient, roundedRectPath } from "../../ui/drawing.js";
import { UiNode } from "../../ui/UiNode.js";
import { withAlpha } from "../../theme/color.js";

/** The shape of the menus' paintings (data/art/Play_*.jpg, 620×630): width over height. */
export const PAINTING_ASPECT = 620 / 630;
/** The emblem's share of the picture's shorter side. */
const EMBLEM_SHARE = 0.46;
/** How much of a dimmed picture shows. */
const DIM_ALPHA = 0.45;

export class TileArt extends UiNode {
  /** The painting (a UiPiece). */
  piece;
  /** The emblem drawn until the painting is ready. */
  icon;
  /** The faction whose colours it takes (theme.colors.factions). */
  faction;
  /** Where the painting is: the menus' art (a UiPiece) or the table's (a TablePiece). @type {"ui" | "table"} */
  from;
  /** Whether it is dimmed. */
  dim;
  /** Whether the painting fills the frame (cropped to it) rather than showing whole. */
  cover;

  /**
   * @param {{ id?: string, x: number, y: number, width: number, height: number, piece: string, icon: string, faction: string, from?: "ui" | "table", dim?: boolean, cover?: boolean }} options
   */
  constructor({ piece, icon, faction, from = "ui", dim = false, cover = false, ...frame }) {
    super(frame);
    this.piece = piece;
    this.icon = icon;
    this.faction = faction;
    this.from = from;
    this.dim = dim;
    this.cover = cover;
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
    const painting = (this.from === "table" ? theme.tableArt : theme.uiArt)?.imageFor(this.piece) ?? null;
    context.save();
    if (this.dim) {
      context.globalAlpha *= DIM_ALPHA;
    }
    this.#paintPicture(context, theme, { area, tones, center, painting });
    context.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   * @param {{ area: { x: number, y: number, width: number, height: number }, tones: { light: string, base: string, dark: string }, center: { x: number, y: number }, painting: import("../../images/ImageCache.js").LoadedImage | null }} picture
   */
  #paintPicture(context, theme, { area, tones, center, painting }) {
    const radius = theme.spacing.radius;
    context.save();
    roundedRectPath(context, area, radius);
    context.clip();
    context.fillStyle = tones.dark;
    context.fillRect(area.x, area.y, area.width, area.height);
    context.fillStyle = radialGradient(context, center, Math.max(area.width, area.height) * 0.7, [[0, withAlpha(tones.base, 0.85)], [0.55, withAlpha(tones.base, 0.25)], [1, withAlpha(tones.dark, 0)]]);
    context.fillRect(area.x, area.y, area.width, area.height);
    if (painting !== null && this.cover) {
      drawImageCover(context, painting, area);
    } else if (painting !== null) {
      const shown = containedRect(painting, area);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(painting.source, shown.x, shown.y, shown.width, shown.height);
    }
    context.restore();
    if (painting === null) {
      const size = Math.min(area.width, area.height) * EMBLEM_SHARE;
      drawIcon(context, this.icon, { x: center.x - size / 2, y: center.y - size / 2, size, color: tones.light });
    }
    context.save();
    roundedRectPath(context, area, radius);
    context.lineWidth = 1.5;
    context.strokeStyle = withAlpha(tones.light, 0.55);
    context.stroke();
    context.restore();
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
