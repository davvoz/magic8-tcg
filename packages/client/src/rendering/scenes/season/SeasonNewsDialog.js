/**
 * The season's news in a modal (docs/tcg/panoramica-funzionale.md): the
 * show (SeasonNewsShow) fills the panel, and under it Skip and Back on the
 * left, Next on the right, which on the last page becomes Let's play.
 * Closing it any way (the buttons, Escape, a click outside) is the end of
 * it: `onClose` is told. Built for the design area it is shown on; a new
 * area is a new dialog, opened on the page the old one was at.
 */
import { Button } from "../../ui/Button.js";
import { Modal } from "../../ui/Modal.js";
import { SeasonNewsShow } from "./SeasonNewsShow.js";

/** The panel on a wide screen; a phone's fills the screen but for a margin. */
const WIDE = Object.freeze({ width: 1400, height: 820, inset: 6, button: Object.freeze({ width: 210, height: 54, gap: 14, margin: 22 }) });
const COMPACT = Object.freeze({ margin: 8, inset: 4, button: Object.freeze({ width: 130, height: 40, gap: 8, margin: 8 }) });

/**
 * @typedef {object} SeasonNewsDialog
 * @property {Modal} modal
 * @property {SeasonNewsShow} show
 * @property {{ width: number, height: number }} builtFor the design area it was laid out on
 */

/**
 * @param {{
 *   viewport: { logicalWidth: number, logicalHeight: number, compact?: boolean },
 *   news: import("../../../application/season/SeasonNews.js").SeasonNews,
 *   cardOf: (cardId: string) => import("../../cards/CardFace.js").CardFaceModel | null,
 *   rarityOf: (cardId: string) => string | null,
 *   play?: import("./SeasonNewsShow.js").PlaySound,
 *   onClose: () => void,
 *   startPage?: number,
 *   settled?: boolean,
 * }} options `settled`: every page shown at its end, without sound (previews, tests)
 * @returns {SeasonNewsDialog}
 */
export function buildSeasonNewsDialog({ viewport, news, cardOf, rarityOf, play, onClose, startPage = 0, settled = false }) {
  const compact = viewport.compact === true;
  const sizes = compact ? COMPACT : WIDE;
  const panelWidth = compact ? viewport.logicalWidth - 2 * COMPACT.margin : Math.min(WIDE.width, viewport.logicalWidth - 40);
  const panelHeight = compact ? viewport.logicalHeight - 2 * COMPACT.margin : Math.min(WIDE.height, viewport.logicalHeight - 40);
  const modal = new Modal({ id: "news", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth, panelHeight, onDismiss: onClose });
  const { panel } = modal;
  const show = new SeasonNewsShow({ id: "news.show", x: sizes.inset, y: sizes.inset, width: panelWidth - 2 * sizes.inset, height: panelHeight - 2 * sizes.inset, news, cardOf, rarityOf, play, compact, settled, startPage });
  panel.add(show);
  const { button } = sizes;
  const y = panelHeight - button.margin - button.height;
  const left = button.margin;
  const right = panelWidth - button.margin - button.width;
  // Next first: it is where the keyboard starts.
  const next = panel.add(new Button({ id: "news.next", x: right, y, width: button.width, height: button.height, text: "Next", variant: "primary", onActivate: () => (show.isLast ? onClose() : turn(show.page + 1)) }));
  const skip = panel.add(new Button({ id: "news.skip", x: left, y, width: button.width, height: button.height, text: "Skip", onActivate: onClose }));
  const back = panel.add(new Button({ id: "news.back", x: left + button.width + button.gap, y, width: button.width, height: button.height, text: "Back", onActivate: () => turn(show.page - 1) }));
  const label = () => {
    next.text = show.isLast ? "Let's play" : "Next";
    skip.visible = !show.isLast;
    back.visible = show.page > 0;
    back.x = skip.visible ? left + button.width + button.gap : left;
  };
  /** @param {number} page */
  const turn = (page) => {
    show.go(page);
    label();
  };
  label();
  return { modal, show, builtFor: { width: viewport.logicalWidth, height: viewport.logicalHeight } };
}
