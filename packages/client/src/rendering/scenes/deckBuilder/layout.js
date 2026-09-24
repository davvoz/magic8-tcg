/**
 * Fixed layout of the deck builder in logical units (1600×900 design
 * space). Both views share the header and the two columns.
 */
export const HEADER = Object.freeze({ y: 24, height: 56, sideMargin: 60, backWidth: 220 });
export const COLUMNS = Object.freeze({
  top: 100,
  height: 770,
  left: Object.freeze({ x: 60, width: 700 }),
  right: Object.freeze({ x: 800, width: 740 }),
});
export const INSET = 20;
export const ROW = Object.freeze({ height: 56, gap: 8 });
export const ACTION = Object.freeze({ width: 90, small: 56, gap: 10 });
export const INSPECT = Object.freeze({ width: 900, height: 620, card: Object.freeze({ width: 380, height: 560 }) });

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
 * @property {() => void} rebuild re-read the service and redraw everything
 * @property {(cardId: string) => void} inspect open the card detail overlay
 * @property {(request: { title: string, message: string, confirmText: string, onConfirm: () => void }) => void} confirm
 * @property {Record<string, number>} scroll persisted scroll offsets by list id
 */
