/**
 * Where the navigation shell puts its parts on the screen in use: the rail
 * of the game's sections down the left edge (the game's name at its top),
 * the top bar across the rest of the top, and the content area left to the
 * screen itself. A phone in landscape (the compact profile, only
 * COMPACT.height units tall) keeps the rail, narrower, under a slimmer bar.
 * Every rectangle is in design-area coordinates; ContentViewport turns them
 * into the content's.
 */
import { rect } from "@magic8/engine/shared/geometry.js";

/**
 * @typedef {import("@magic8/engine/shared/geometry.js").Rect} Rect
 * @typedef {Readonly<{
 *   compact: boolean,
 *   rail: Rect,
 *   logo: Rect,
 *   bar: Rect,
 *   content: Rect,
 *   items: Readonly<{ x: number, top: number, width: number, height: number, gap: number }>,
 *   controls: Readonly<{ y: number, height: number, gap: number, padding: number }>,
 * }>} ShellLayout `logo`: the rail's top cell, beside the bar; `items`: the sections' entries down the rail;
 *   `controls`: the bar's buttons and chips (their row, height and spacing) and its margin at either end
 */

/** The sizes of each profile: the rail's width, the bar's height, the rail's entries and the bar's controls. */
const SIZES = Object.freeze({
  wide: Object.freeze({ rail: 112, bar: 76, item: Object.freeze({ inset: 8, height: 84, gap: 10, top: 96 }), control: Object.freeze({ height: 48, gap: 12, padding: 24 }) }),
  compact: Object.freeze({ rail: 84, bar: 52, item: Object.freeze({ inset: 5, height: 62, gap: 6, top: 0 }), control: Object.freeze({ height: 46, gap: 8, padding: 10 }) }),
});

/** How many sections the rail lists: a compact rail spreads them over its height. */
export const SECTION_COUNT = 5;

/** @type {Map<string, ShellLayout>} */
const cache = new Map();

/**
 * @param {{ compact?: boolean, logicalWidth: number, logicalHeight: number }} viewport the screen's design area
 * @returns {ShellLayout}
 */
export function shellLayout(viewport) {
  const compact = viewport.compact === true;
  const key = `${compact ? "compact" : "wide"}:${viewport.logicalWidth}x${viewport.logicalHeight}`;
  let layout = cache.get(key);
  if (layout === undefined) {
    layout = build(compact, viewport.logicalWidth, viewport.logicalHeight);
    cache.set(key, layout);
  }
  return layout;
}

/**
 * @param {boolean} compact
 * @param {number} width
 * @param {number} height
 * @returns {ShellLayout}
 */
function build(compact, width, height) {
  const size = compact ? SIZES.compact : SIZES.wide;
  const { item, control } = size;
  const run = SECTION_COUNT * item.height + (SECTION_COUNT - 1) * item.gap;
  // A compact rail centres its entries under the logo; a wide one starts them a little below it.
  const top = compact ? size.bar + Math.max(0, (height - size.bar - run) / 2) : item.top;
  return Object.freeze({
    compact,
    rail: rect(0, 0, size.rail, height),
    logo: rect(0, 0, size.rail, size.bar),
    bar: rect(size.rail, 0, width - size.rail, size.bar),
    content: rect(size.rail, size.bar, width - size.rail, height - size.bar),
    items: Object.freeze({ x: item.inset, top, width: size.rail - 2 * item.inset, height: item.height, gap: item.gap }),
    controls: Object.freeze({ y: Math.round((size.bar - control.height) / 2), height: control.height, gap: control.gap, padding: control.padding }),
  });
}
