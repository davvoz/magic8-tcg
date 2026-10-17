/**
 * One of the sections on the Home screen, which is the way to them (there
 * is no rail): the whole card opens it. Its picture fills the card above
 * the words, or, on a card much wider than tall (Play on a wide screen),
 * most of it on the left, the words beside it: a painting (whole, in a
 * glow of the section's colour, or filling the box when it was painted to
 * its shape; in a box wider than tall, its landscape version when it has
 * one), or the section's emblem until there is one. The words are its name and a line on what is there
 * or where the player stands; the painted gold corners only at its foot,
 * none round the picture. A section that cannot be opened here wears a
 * padlock and its line says why; opened, it says so again (the shell's
 * notice). Wide and compact (a phone) metrics.
 */
import { SoundCue } from "../../../application/audio/SoundCue.js";
import { drawIcon, Icon } from "../../ui/icons.js";
import { Label } from "../../ui/Label.js";
import { Panel, PANEL_INSET, PANEL_TITLE_INSET, PanelCorners, SMALL_PANEL_INSET, SMALL_PANEL_TITLE_INSET } from "../../ui/Panel.js";
import { roundedRectPath } from "../../ui/drawing.js";
import { TileArt } from "../play/TileArt.js";

/**
 * @typedef {Readonly<{
 *   inset: number, picture: number, pad: number, name: number, line: number, gap: number, lock: number, smallCorners: boolean,
 *   sizes: Readonly<{ name: import("../../theme/Theme.js").FontSize, line: import("../../theme/Theme.js").FontSize }>,
 * }>} NavMetrics `inset`: what the words keep from the card's foot (its painted corners); `picture`: the picture's
 *   margin from the card's edges; `pad`: the words' margin from the picture's left edge
 */
/** @type {Readonly<{ wide: NavMetrics, compact: NavMetrics }>} */
const METRICS = Object.freeze({
  wide: Object.freeze({ inset: PANEL_INSET, picture: PANEL_INSET / 2, pad: 16, name: 44, line: 28, gap: 6, lock: 28, smallCorners: false, sizes: Object.freeze({ name: "heading", line: "body" }) }),
  compact: Object.freeze({ inset: SMALL_PANEL_INSET, picture: SMALL_PANEL_INSET / 2, pad: 8, name: 26, line: 18, gap: 4, lock: 18, smallCorners: true, sizes: Object.freeze({ name: "body", line: "tiny" }) }),
});
/** How much wider than tall a card must be to have its picture beside the words rather than above them. */
const SIDE_BY_SIDE = 2.2;
/** A picture beside the words: the most of the card's width it takes, and its widest shape (width over height). */
const SIDE_PICTURE = Object.freeze({ share: 0.68, aspect: 2.2 });
/** The focus ring's width. */
const FOCUS_WIDTH = 3;

/**
 * @typedef {Readonly<{ piece: string, icon: string, faction: string, from?: "ui" | "table", cover?: boolean, landscape?: string }>} NavPicture
 *   the painting (a UiPiece, or a TablePiece with `from: "table"`; `cover`: filling the box; `landscape`: the one for a
 *   box wider than tall, when there is one) and the emblem shown until it is ready
 */

export class NavCard extends Panel {
  /** Whether the section cannot be opened here: a padlock beside the name. */
  locked;
  /** Whether the picture is beside the words rather than above them. */
  sideBySide;
  /** @type {NavMetrics} */
  #metrics;
  /** Where the words start. */
  #text;

  /**
   * @param {{ id: string, x: number, y: number, width: number, height: number, compact: boolean,
   *   picture: NavPicture, name: string, line: string, locked: boolean, onActivate: () => void }} options
   */
  constructor({ compact, picture, name, line, locked, onActivate, ...frame }) {
    const metrics = compact ? METRICS.compact : METRICS.wide;
    super({ ...frame, smallCorners: metrics.smallCorners, corners: PanelCorners.FOOT, onActivate });
    this.locked = locked;
    this.focusable = true;
    this.activationCue = SoundCue.UI_CLICK;
    this.#metrics = metrics;
    const margin = metrics.picture;
    const words = metrics.name + metrics.line;
    this.sideBySide = frame.width >= SIDE_BY_SIDE * frame.height;
    let art;
    if (this.sideBySide) {
      const height = frame.height - 2 * margin;
      art = { x: margin, y: margin, width: Math.round(Math.min(frame.width * SIDE_PICTURE.share, height * SIDE_PICTURE.aspect)), height };
      this.#text = { x: art.x + art.width + metrics.inset, y: Math.round((frame.height - words) / 2) };
    } else {
      // The words keep clear of the painted corners at the foot.
      art = { x: margin, y: margin, width: frame.width - 2 * margin, height: frame.height - margin - metrics.inset - words - 2 * metrics.gap };
      // Along the foot, beside the painted corners: past their curl.
      this.#text = { x: Math.max(margin + metrics.pad, metrics.smallCorners ? SMALL_PANEL_TITLE_INSET : PANEL_TITLE_INSET), y: art.y + art.height + 2 * metrics.gap };
    }
    const { landscape, ...painting } = picture;
    this.add(new TileArt({ id: `${frame.id}.art`, ...art, ...painting, piece: art.width > art.height && landscape !== undefined ? landscape : painting.piece, dim: locked }));
    const nameX = this.#text.x + (locked ? metrics.lock + 6 : 0);
    this.add(new Label({ id: `${frame.id}.name`, x: nameX, y: this.#text.y, width: frame.width - nameX - metrics.inset, height: metrics.name, text: name, size: metrics.sizes.name, weight: "bold", colorKey: locked ? "textMuted" : "accentLight", align: "left", fit: true }));
    this.add(new Label({ id: `${frame.id}.line`, x: this.#text.x, y: this.#text.y + metrics.name, width: frame.width - this.#text.x - metrics.inset, height: metrics.line, text: line, size: metrics.sizes.line, colorKey: "textMuted", align: "left", fit: true }));
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    super.paint(context, theme);
    const area = this.bounds;
    if (this.locked) {
      const { name, lock } = this.#metrics;
      drawIcon(context, Icon.LOCK, { x: area.x + this.#text.x, y: area.y + this.#text.y + (name - lock) / 2, size: lock, color: theme.colors.textMuted });
    }
    if (this.focused) {
      context.save();
      roundedRectPath(context, area, theme.spacing.radius);
      context.lineWidth = FOCUS_WIDTH;
      context.strokeStyle = theme.colors.focus;
      context.stroke();
      context.restore();
    }
  }
}
