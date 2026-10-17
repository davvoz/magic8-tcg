import { PANEL_INSET, SMALL_PANEL_INSET } from "../../ui/Panel.js";

/**
 * The frame the deck builder, the collection, the shop and the other
 * account screens share, laid out in the content area the navigation
 * shell leaves them (their viewport's design area): a toolbar row along
 * the top for the screen's status and its own buttons (its title and Back
 * are the shell's), and two columns side by side below it. A screen
 * without a toolbar (`toolbar: false`) gives its columns that room too.
 * `screenLayout` gives the frame for the screen in use: a roomy one on a
 * wide screen, a tighter one on a compact one (a phone in landscape).
 */
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
 *   rowY: (index: number) => number,
 *   rowsHeight: (count: number) => number,
 * }>} ScreenLayout `header`: the toolbar row (its buttons are `backWidth` wide, `gap` apart, and keep 4 units from its top and
 *   foot); `panel`: options every column panel takes
 */

/**
 * Each profile's frame: the margins, the toolbar, the gaps, the columns' split, the rows and the in-row buttons.
 * `split`: the left column's share of the width the two columns share.
 */
const FRAMES = Object.freeze({
  wide: Object.freeze({
    margin: 20,
    bottom: 20,
    gap: 24,
    split: 0.49,
    header: Object.freeze({ y: 12, height: 56, backWidth: 220, gap: 16 }),
    toolbarGap: 12,
    top: 20,
    inset: INSET,
    row: ROW,
    action: ACTION,
    smallCorners: false,
  }),
  compact: Object.freeze({
    margin: 10,
    bottom: 5,
    gap: 10,
    split: 0.5,
    header: Object.freeze({ y: 2, height: 54, backWidth: 120, gap: 8 }),
    toolbarGap: 2,
    top: 6,
    inset: SMALL_PANEL_INSET,
    row: Object.freeze({ height: 48, gap: 6 }),
    action: Object.freeze({ width: 72, small: 46, gap: 8 }),
    smallCorners: true,
  }),
});

/**
 * The frame for the screen in use.
 * @param {{ compact?: boolean, logicalWidth: number, logicalHeight: number }} viewport the content area the screen has
 * @param {{ toolbar?: boolean }} [options] `toolbar`: whether the screen has a toolbar row above its columns (it has by default)
 * @returns {ScreenLayout}
 */
export function screenLayout(viewport, { toolbar = true } = {}) {
  const compact = viewport.compact === true;
  const frame = compact ? FRAMES.compact : FRAMES.wide;
  const { margin, gap, header, row } = frame;
  const top = toolbar ? header.y + header.height + frame.toolbarGap : frame.top;
  const inner = viewport.logicalWidth - 2 * margin - gap;
  const left = Math.round(inner * frame.split);
  const rowAt = (/** @type {number} */ index) => index * (row.height + row.gap);
  return Object.freeze({
    compact,
    header: Object.freeze({ ...header, sideMargin: margin }),
    columns: Object.freeze({
      top,
      height: viewport.logicalHeight - top - frame.bottom,
      left: Object.freeze({ x: margin, width: left }),
      right: Object.freeze({ x: margin + left + gap, width: inner - left }),
    }),
    inset: frame.inset,
    row,
    action: frame.action,
    panel: Object.freeze({ smallCorners: frame.smallCorners }),
    rowY: rowAt,
    rowsHeight: (/** @type {number} */ count) => (count === 0 ? 0 : rowAt(count) - row.gap),
  });
}

/**
 * What the deck builder's views are given.
 *
 * @typedef {object} BuilderHost
 * @property {import("../../../application/AppContext.js").AppContext} app
 * @property {import("../../theme/Theme.js").Theme} theme
 * @property {() => ScreenLayout} screen the frame for the screen in use
 * @property {{ viewport: { logicalWidth: number, logicalHeight: number }, open: (modal: import("../../ui/Modal.js").Modal) => void, close: () => void }} dialog opens and closes a dialog over the builder (the compact card filter)
 * @property {() => void} rebuild re-read the service and redraw everything
 * @property {(cardId: string) => void} inspect open the card detail overlay
 * @property {(request: { title: string, message: string, confirmText: string, destructive?: boolean, onConfirm: () => void }) => void} confirm
 * @property {() => void} closed the deck was closed (its draft discarded): leave the builder
 * @property {Record<string, number>} scroll persisted scroll offsets by list id
 */
