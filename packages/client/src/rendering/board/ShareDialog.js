/**
 * The dialog that shares a finished game as a ping on cur8.fun: the picture
 * of the result and the ping beside it, as they will read, and Post. The
 * picture shown is the one that will be posted, once it is painted (the card
 * is drawn in its place meanwhile). While it is being posted the buttons
 * wait; a failure is told under them, and Post works again.
 */
import { ShareCardNode, SHARE_CARD_SIZE } from "../share/ShareCard.js";
import { Button } from "../ui/Button.js";
import { Label } from "../ui/Label.js";
import { Modal } from "../ui/Modal.js";
import { Panel, PANEL_INSET, SMALL_PANEL_INSET } from "../ui/Panel.js";
import { TextBlock } from "../ui/TextBlock.js";
import { UiNode } from "../ui/UiNode.js";
import { fillRoundedRect } from "../ui/drawing.js";

/**
 * @typedef {Readonly<{ width: number, height: number, inset: number, title: number, note: number, picture: number, status: number, buttonHeight: number, gap: number, pad: number, text: import("../theme/Theme.js").FontSize }>} ShareMetrics
 *   `picture`: the picture's width (its height follows the card's proportions); `pad`: how far the ping's text keeps from its box's sides, clear of the painted corners
 */
/** @type {ShareMetrics} */
const WIDE = Object.freeze({ width: 940, height: 470, inset: PANEL_INSET, title: 48, note: 28, picture: 440, status: 30, buttonHeight: 52, gap: 14, pad: SMALL_PANEL_INSET + 8, text: "small" });
/** @type {ShareMetrics} */
const COMPACT = Object.freeze({ width: 640, height: 340, inset: SMALL_PANEL_INSET, title: 34, note: 20, picture: 270, status: 22, buttonHeight: 46, gap: 10, pad: SMALL_PANEL_INSET + 4, text: "tiny" });

/** @typedef {Readonly<{ kind: "ready" } | { kind: "posting" } | { kind: "failed", message: string }>} ShareState */

/**
 * @param {{ viewport: { logicalWidth: number, logicalHeight: number, compact: boolean }, text: string, card: import("../../application/social/shareCard.js").ShareCard, picture?: import("../../application/ports/ShareImage.contract.js").SharePicture["image"] | null, state: ShareState, onPost: () => void, onClose: () => void }} options
 *   `picture`: the painted picture that will be posted (null: not painted yet)
 * @returns {Modal}
 */
export function buildShareDialog({ viewport, text, card, picture = null, state, onPost, onClose }) {
  const m = viewport.compact ? COMPACT : WIDE;
  const width = Math.min(m.width, viewport.logicalWidth - 20);
  const height = Math.min(m.height, viewport.logicalHeight - 20);
  const posting = state.kind === "posting";
  const modal = new Modal({ id: "share", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: width, panelHeight: height, onDismiss: posting ? () => undefined : onClose });
  const { panel } = modal;
  const inner = width - 2 * m.inset;
  let y = m.inset / 2;
  panel.add(new Label({ x: m.inset, y, width: inner, height: m.title, text: "Share on cur8.fun", size: "heading", weight: "bold", colorKey: "accentLight", fit: true }));
  y += m.title;
  panel.add(new Label({ x: m.inset, y, width: inner, height: m.note, text: "A ping on your profile, under today's Pings wall:", size: "small", colorKey: "textMuted", align: "left", fit: true }));
  y += m.note + 4;
  const pictureHeight = (m.picture * SHARE_CARD_SIZE.height) / SHARE_CARD_SIZE.width;
  const frame = { id: "share.picture", x: m.inset, y, width: m.picture, height: pictureHeight };
  panel.add(picture === null ? new ShareCardNode({ ...frame, card }) : new PictureNode({ ...frame, picture }));
  const textX = m.inset + m.picture + m.gap;
  const quote = panel.add(new Panel({ id: "share.ping", x: textX, y, width: inner - m.picture - m.gap, height: pictureHeight, fillKey: "panelDark", smallCorners: true }));
  quote.add(new TextBlock({ id: "share.text", x: m.pad, y: m.pad, width: quote.width - 2 * m.pad, height: quote.height - 2 * m.pad, text, size: m.text }));
  const buttonsY = height - m.inset / 2 - m.buttonHeight;
  const status = statusOf(state);
  panel.add(new Label({ id: "share.status", x: m.inset, y: buttonsY - m.gap - m.status, width: inner, height: m.status, text: status.text, size: "small", colorKey: status.colorKey, align: "left", fit: true }));
  const half = (inner - m.gap) / 2;
  panel.add(new Button({ id: "share.back", x: m.inset, y: buttonsY, width: half, height: m.buttonHeight, text: "Back", enabled: !posting, onActivate: onClose }));
  panel.add(new Button({ id: "share.post", x: m.inset + half + m.gap, y: buttonsY, width: half, height: m.buttonHeight, text: posting ? "Posting…" : "Post ping", variant: "primary", enabled: !posting, onActivate: onPost }));
  return modal;
}

/** The picture that will be posted, scaled into its box. */
class PictureNode extends UiNode {
  #picture;

  /**
   * @param {{ id?: string, x: number, y: number, width: number, height: number, picture: { source: unknown, width: number, height: number } }} options
   */
  constructor({ picture, ...frame }) {
    super(frame);
    this.passthrough = true;
    this.#picture = picture;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const { x, y, width, height } = this.bounds;
    context.save();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(/** @type {CanvasImageSource} */ (this.#picture.source), x, y, width, height);
    context.restore();
    fillRoundedRect(context, { x, y, width, height }, { stroke: theme.colors.panelBorder, radius: 4, lineWidth: 1 });
  }
}

/** @param {ShareState} state */
function statusOf(state) {
  if (state.kind === "posting") {
    return { text: "Posting your ping…", colorKey: "textMuted" };
  }
  if (state.kind === "failed") {
    return { text: `Not posted: ${state.message}`, colorKey: "danger" };
  }
  return { text: "Published from your account, like any post on Steem.", colorKey: "textMuted" };
}
