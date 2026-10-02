import { PANEL_INSET, SMALL_PANEL_INSET } from "../../ui/Panel.js";

/**
 * Fixed layout of the deck builder in logical units (1600×900 design
 * space). Both views share the header and the two columns; the collection,
 * the shop and the other account screens use the same frame.
 * `screenLayout` gives the same frame for the screen in use: these
 * values on a wide one, a tighter frame on a compact one (a phone in
 * landscape) with the two columns side by side all the same.
 */
export const HEADER = Object.freeze({ y: 24, height: 56, sideMargin: 60, backWidth: 220 });
export const COLUMNS = Object.freeze({
  top: 100,
  height: 770,
  left: Object.freeze({ x: 60, width: 700 }),
  right: Object.freeze({ x: 800, width: 740 }),
});
/** Padding inside the column panels, clear of their painted corners. */
export const INSET = PANEL_INSET;
export const ROW = Object.freeze({ height: 56, gap: 8 });
export const ACTION = Object.freeze({ width: 90, small: 56, gap: 10 });
export const INSPECT = Object.freeze({ width: 900, height: 620, card: Object.freeze({ width: 380, height: 560 }) });

/**
 * @typedef {Readonly<{
 *   compact: boolean,
 *   header: Readonly<{ y: number, height: number, sideMargin: number, backWidth: number, gap: number }>,
 *   columns: Readonly<{ top: number, height: number, left: Readonly<{ x: number, width: number }>, right: Readonly<{ x: number, width: number }> }>,
 *   inset: number,
 *   row: Readonly<{ height: number, gap: number }>,
 *   action: Readonly<{ width: number, small: number, gap: number }>,
 *   panel: Readonly<{ smallCorners: boolean }>,
 *   backText: string,
 *   rowY: (index: number) => number,
 *   rowsHeight: (count: number) => number,
 * }>} ScreenLayout `header.gap`: between the header's buttons; `panel`: options every column panel takes; `backText`: the label of the button back to the menu
 */

/** The compact frame: its margins, header, rows and in-row buttons. */
const COMPACT = Object.freeze({
  margin: 10,
  gap: 10,
  header: Object.freeze({ y: 6, height: 56, backWidth: 120, gap: 8 }),
  row: Object.freeze({ height: 48, gap: 6 }),
  action: Object.freeze({ width: 72, small: 46, gap: 8 }),
});

/** @type {ScreenLayout} */
const WIDE = Object.freeze({
  compact: false,
  header: Object.freeze({ ...HEADER, gap: 16 }),
  columns: COLUMNS,
  inset: INSET,
  row: ROW,
  action: ACTION,
  panel: Object.freeze({ smallCorners: false }),
  backText: "Back to menu",
  rowY,
  rowsHeight,
});

/**
 * The frame for the screen in use.
 * @param {{ compact?: boolean, logicalWidth: number, logicalHeight: number }} viewport
 * @returns {ScreenLayout}
 */
export function screenLayout(viewport) {
  if (viewport.compact !== true) {
    return WIDE;
  }
  const { margin, gap, header, row } = COMPACT;
  const top = header.y + header.height + 6;
  const inner = viewport.logicalWidth - 2 * margin - gap;
  const left = Math.round(inner / 2);
  const rowAt = (index) => index * (row.height + row.gap);
  return Object.freeze({
    compact: true,
    header: Object.freeze({ ...header, sideMargin: margin }),
    columns: Object.freeze({
      top,
      height: viewport.logicalHeight - top - margin / 2,
      left: Object.freeze({ x: margin, width: left }),
      right: Object.freeze({ x: margin + left + gap, width: inner - left }),
    }),
    inset: SMALL_PANEL_INSET,
    row,
    action: COMPACT.action,
    panel: Object.freeze({ smallCorners: true }),
    backText: "Menu",
    rowY: rowAt,
    rowsHeight: (count) => (count === 0 ? 0 : rowAt(count) - row.gap),
  });
}

/**
 * @param {number} index
 * @returns {number} y of the index-th row inside a list
 */
export function rowY(index) {
  return index * (ROW.height + ROW.gap);
}

/**
 * @param {number} count
 * @returns {number} total height of `count` rows
 */
export function rowsHeight(count) {
  return count === 0 ? 0 : rowY(count) - ROW.gap;
}

/**
 * Shared shape for the deck builder's three views.
 *
 * @typedef {object} BuilderHost
 * @property {import("../../../application/AppContext.js").AppContext} app
 * @property {import("../../theme/Theme.js").Theme} theme
 * @property {() => ScreenLayout} screen the frame for the screen in use
 * @property {{ viewport: { logicalWidth: number, logicalHeight: number }, open: (modal: import("../../ui/Modal.js").Modal) => void, close: () => void }} dialog opens and closes a dialog over the builder (the compact card filter)
 * @property {() => void} rebuild re-read the service and redraw everything
 * @property {(cardId: string) => void} inspect open the card detail overlay
 * @property {(request: { title: string, message: string, confirmText: string, destructive?: boolean, onConfirm: () => void }) => void} confirm
 * @property {Record<string, number>} scroll persisted scroll offsets by list id
 */
