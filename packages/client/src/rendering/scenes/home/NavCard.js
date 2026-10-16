/**
 * One of the sections on a phone's Home, which has no rail: the whole card
 * opens it. Its picture fills the card above the words, the same box in
 * every card, so the four line up: a painting (whole, in a glow of the
 * section's colour), or the section's emblem until there is one. Under it,
 * its name and a line on what is there or where the player stands. A section that cannot be opened here
 * wears a padlock and its line says why; opened, it says so again (the
 * shell's notice).
 */
import { SoundCue } from "../../../application/audio/SoundCue.js";
import { drawIcon, Icon } from "../../ui/icons.js";
import { Label } from "../../ui/Label.js";
import { Panel, SMALL_PANEL_INSET } from "../../ui/Panel.js";
import { roundedRectPath } from "../../ui/drawing.js";
import { TileArt } from "../play/TileArt.js";

/** The name's and the line's heights under the picture, the gap between the parts, the padlock's size and the focus ring's width. */
const PARTS = Object.freeze({ name: 26, line: 18, gap: 4, lock: 18, focusWidth: 3 });

export class NavCard extends Panel {
  /** Whether the section cannot be opened here: a padlock beside the name. */
  locked;
  /** Where the name starts, under the picture. */
  #textTop;

  /**
   * @param {{ id: string, x: number, y: number, width: number, height: number,
   *   picture: { piece: string, icon: string, faction: string, from?: "ui" | "table" }, name: string, line: string, locked: boolean, onActivate: () => void }} options
   *   `picture`: the painting (a UiPiece, or a TablePiece with `from: "table"`) and the emblem shown until it is ready
   */
  constructor({ picture, name, line, locked, onActivate, ...frame }) {
    super({ ...frame, smallCorners: true, onActivate });
    this.locked = locked;
    this.focusable = true;
    this.activationCue = SoundCue.UI_CLICK;
    const inset = SMALL_PANEL_INSET / 2;
    const artWidth = frame.width - 2 * inset;
    // The words keep clear of the painted corners at the foot.
    const artHeight = frame.height - inset - SMALL_PANEL_INSET - PARTS.line - PARTS.name - 2 * PARTS.gap;
    const top = inset;
    const textTop = top + artHeight + 2 * PARTS.gap;
    this.#textTop = textTop;
    this.add(new TileArt({ id: `${frame.id}.art`, x: inset, y: top, width: artWidth, height: artHeight, ...picture, dim: locked }));
    const nameX = inset + 8 + (locked ? PARTS.lock + 6 : 0);
    this.add(new Label({ id: `${frame.id}.name`, x: nameX, y: textTop, width: frame.width - nameX - inset, height: PARTS.name, text: name, size: "body", weight: "bold", colorKey: locked ? "textMuted" : "accentLight", align: "left", fit: true }));
    this.add(new Label({ id: `${frame.id}.line`, x: inset + 8, y: textTop + PARTS.name, width: frame.width - 2 * inset - 16, height: PARTS.line, text: line, size: "tiny", colorKey: "textMuted", align: "left", fit: true }));
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    super.paint(context, theme);
    const area = this.bounds;
    if (this.locked) {
      const inset = SMALL_PANEL_INSET / 2;
      const y = area.y + this.#textTop + (PARTS.name - PARTS.lock) / 2;
      drawIcon(context, Icon.LOCK, { x: area.x + inset + 8, y, size: PARTS.lock, color: theme.colors.textMuted });
    }
    if (this.focused) {
      context.save();
      roundedRectPath(context, area, theme.spacing.radius);
      context.lineWidth = PARTS.focusWidth;
      context.strokeStyle = theme.colors.focus;
      context.stroke();
      context.restore();
    }
  }
}
