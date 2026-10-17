/**
 * The game's name in the top bar (TopBar places it): the painted logo
 * (Theme.uiArt, cut out on transparency) once it is ready, else its
 * letters in gold. Given somewhere to go (`onActivate`: Home), it is a
 * button: a soft gold light under the pointer, a ring when focused. Given
 * its light (LogoLight), the painted name lives: a sheen, sparks, the star.
 */
import { SoundCue } from "../../application/audio/SoundCue.js";
import { UiPiece } from "../images/UiArt.js";
import { radialGradient, roundedRectPath } from "../ui/drawing.js";
import { withAlpha } from "../theme/color.js";
import { drawTextInRect } from "../ui/drawing.js";
import { UiNode } from "../ui/UiNode.js";
import { displayFont } from "../theme/Theme.js";

/** How much of its box the painted name may fill, and the letters' size as a share of the box's height. */
const FILL = Object.freeze({ image: 0.94, letters: 0.36 });

export class GameLogo extends UiNode {
  /** Where a click leads (Home), or null for a logo that only shows. @type {(() => void) | null} */
  onActivate;
  /** The light that lives in the painted name, or null for none. @type {import("./LogoLight.js").LogoLight | null} */
  #light;

  /** @param {{ id?: string, x: number, y: number, width: number, height: number, onActivate?: (() => void) | null, light?: import("./LogoLight.js").LogoLight | null }} frame */
  constructor({ onActivate = null, light = null, ...frame }) {
    super(frame);
    this.onActivate = onActivate;
    this.#light = light;
    this.passthrough = onActivate === null;
    this.interactive = onActivate !== null;
    this.focusable = onActivate !== null;
    this.activationCue = onActivate === null ? null : SoundCue.UI_CLICK;
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
    const cell = this.bounds;
    this.#paintLight(context, theme);
    const image = theme.uiArt?.imageFor(UiPiece.TITLE) ?? null;
    if (image === null) {
      drawTextInRect(context, "KIJAM", cell, { font: displayFont(theme, Math.round(cell.height * FILL.letters)), color: theme.colors.accentLight });
      return;
    }
    const scale = Math.min((cell.width * FILL.image) / image.width, (cell.height * FILL.image) / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    const box = { x: cell.x + (cell.width - width) / 2, y: cell.y + (cell.height - height) / 2, width, height };
    context.save();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image.source, box.x, box.y, width, height);
    context.restore();
    const letters = theme.uiArt?.layout.title;
    if (this.#light !== null && letters !== undefined) {
      this.#light.paint(context, theme, { image, box, letters });
    }
  }

  /**
   * Under the pointer, a soft gold light behind the logo; focused, a ring round it.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  #paintLight(context, theme) {
    if (this.onActivate === null || !(this.hovered || this.focused)) {
      return;
    }
    const cell = this.bounds;
    const { colors } = theme;
    context.save();
    context.fillStyle = radialGradient(context, { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 }, cell.width * 0.55, [[0, withAlpha(colors.accent, 0.22)], [1, withAlpha(colors.accent, 0)]]);
    context.fillRect(cell.x, cell.y, cell.width, cell.height);
    if (this.focused) {
      roundedRectPath(context, { x: cell.x + 2, y: cell.y + 4, width: cell.width - 4, height: cell.height - 8 }, theme.spacing.radius);
      context.lineWidth = 2;
      context.strokeStyle = colors.focus;
      context.stroke();
    }
    context.restore();
  }
}
