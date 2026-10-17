/**
 * The game's name in the top bar (TopBar places it): the painted logo
 * (Theme.uiArt, cut out on transparency) once it is ready, else its
 * letters in gold. Drawing only.
 */
import { UiPiece } from "../images/UiArt.js";
import { drawTextInRect } from "../ui/drawing.js";
import { UiNode } from "../ui/UiNode.js";
import { displayFont } from "../theme/Theme.js";

/** How much of its box the painted name may fill, and the letters' size as a share of the box's height. */
const FILL = Object.freeze({ image: 0.86, letters: 0.36 });

export class GameLogo extends UiNode {
  /** @param {{ id?: string, x: number, y: number, width: number, height: number }} frame */
  constructor(frame) {
    super(frame);
    this.passthrough = true;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const cell = this.bounds;
    const image = theme.uiArt?.imageFor(UiPiece.TITLE) ?? null;
    if (image === null) {
      drawTextInRect(context, "KIJAM", cell, { font: displayFont(theme, Math.round(cell.height * FILL.letters)), color: theme.colors.accentLight });
      return;
    }
    const scale = Math.min((cell.width * FILL.image) / image.width, (cell.height * FILL.image) / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.save();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image.source, cell.x + (cell.width - width) / 2, cell.y + (cell.height - height) / 2, width, height);
    context.restore();
  }
}
