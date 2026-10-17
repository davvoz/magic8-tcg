/**
 * Where the navigation shell puts its parts on the screen in use: the top
 * bar across the whole width, and the content area under it, left to the
 * screen itself. There is no rail of sections: Home lists them (HomeScene),
 * and every other section's screen has Back to Home. A phone in landscape
 * (the compact profile, only COMPACT.height units tall) has a slimmer bar.
 *
 * The bar keeps to the edges of what the window shows (clear of a notch:
 * the viewport's `safeBounds`), not to the design area's: a
 * window of another shape than 16:9 gives the content the room it adds,
 * up to MAX_CONTENT (beyond it the content is centred in what is left).
 * Every rectangle is in design-area coordinates; ContentViewport turns them
 * into the content's.
 */
import { rect } from "@magic8/engine/shared/geometry.js";

/**
 * @typedef {import("@magic8/engine/shared/geometry.js").Rect} Rect
 * @typedef {Readonly<{
 *   compact: boolean,
 *   bar: Rect,
 *   content: Rect,
 *   controls: Readonly<{ y: number, height: number, gap: number, padding: number }>,
 * }>} ShellLayout `controls`: the bar's buttons and chips (their row, height and spacing) and its margin at either end
 */

/** The sizes of each profile: the bar's height and its controls. */
const SIZES = Object.freeze({
  wide: Object.freeze({ bar: 76, control: Object.freeze({ height: 48, gap: 12, padding: 24 }) }),
  compact: Object.freeze({ bar: 52, control: Object.freeze({ height: 46, gap: 8, padding: 10 }) }),
});

/** The largest content area, in logical units: on a very wide or tall window, the content does not stretch past it. */
const MAX_CONTENT = Object.freeze({ width: 2200, height: 1300 });

/** @type {Map<string, ShellLayout>} */
const cache = new Map();
const CACHE_LIMIT = 32;

/**
 * @param {{ compact?: boolean, logicalWidth: number, logicalHeight: number, safeBounds?: Rect }} viewport the screen's: its design
 *   area and what the window shows of the canvas, clear of its unsafe edges (the design area when not given)
 * @returns {ShellLayout}
 */
export function shellLayout(viewport) {
  const compact = viewport.compact === true;
  const shown = viewport.safeBounds ?? rect(0, 0, viewport.logicalWidth, viewport.logicalHeight);
  // Whole units: the content's origin is where everything on the screen is drawn from.
  const edges = { left: Math.ceil(shown.x), top: Math.ceil(shown.y), right: Math.floor(shown.x + shown.width), bottom: Math.floor(shown.y + shown.height) };
  const key = `${compact ? "compact" : "wide"}:${edges.left},${edges.top},${edges.right},${edges.bottom}`;
  let layout = cache.get(key);
  if (layout === undefined) {
    if (cache.size >= CACHE_LIMIT) {
      // A window being resized goes through many shapes: only the latest few are worth keeping.
      cache.clear();
    }
    layout = build(compact, edges);
    cache.set(key, layout);
  }
  return layout;
}

/**
 * @param {boolean} compact
 * @param {{ left: number, top: number, right: number, bottom: number }} edges what the window shows
 * @returns {ShellLayout}
 */
function build(compact, { left, top, right, bottom }) {
  const size = compact ? SIZES.compact : SIZES.wide;
  const { control } = size;
  const room = { x: left, y: top + size.bar, width: right - left, height: bottom - top - size.bar };
  const width = Math.min(MAX_CONTENT.width, room.width);
  const contentHeight = Math.min(MAX_CONTENT.height, room.height);
  return Object.freeze({
    compact,
    bar: rect(room.x, top, room.width, size.bar),
    content: rect(room.x + Math.floor((room.width - width) / 2), room.y + Math.floor((room.height - contentHeight) / 2), width, contentHeight),
    controls: Object.freeze({ y: Math.round((size.bar - control.height) / 2), height: control.height, gap: control.gap, padding: control.padding }),
  });
}
