/**
 * Weathering for the title's gold: a seamless tile of rust and wear, laid
 * over the letters as a pattern (so it falls only on them). Irregular
 * blotches of rust from orange to near black, pitting, bright flecks where
 * the metal is worn back to gold, and fine scratches. Seeded, so the same
 * seed weathers the same way. Drawn once, on an offscreen canvas; where
 * there is none (under test) there is no weathering.
 */
import { withAlpha } from "../../theme/color.js";
import { randomStream } from "../../ui/backdropLight.js";

/** The tile's side, in logical pixels (the pattern repeats in the title's own space). */
const TILE = 320;
/** How many of each mark the tile carries, and their sizes in pixels. */
const MARKS = Object.freeze({
  blotches: 40, blotchRadius: Object.freeze({ min: 8, max: 42 }),
  pits: 700, pitRadius: Object.freeze({ min: 0.3, max: 1 }),
  flecks: 260, fleckRadius: Object.freeze({ min: 0.3, max: 0.9 }),
  scratches: 34, scratchLength: Object.freeze({ min: 6, max: 34 }),
});
/** Rust from fresh to old: copper, orange, brown, and a dark crust (the fresher, the likelier). */
const RUST = Object.freeze(["#c46a24", "#a8501a", "#7a3612", "#3a1808"]);
const CRUST = RUST[3];
const WORN = "#fff1c6";

/**
 * @param {CanvasRenderingContext2D} context the context the pattern is for
 * @param {string} seed
 * @returns {CanvasPattern | null} null where no offscreen canvas can be made
 */
export function rustPattern(context, seed) {
  const surface = makeSurface(TILE);
  const tile = surface?.getContext("2d") ?? null;
  if (surface === null || tile === null || typeof context.createPattern !== "function") {
    return null;
  }
  const random = randomStream(seed);
  const pick = (/** @type {{ min: number, max: number }} */ span) => span.min + random() * (span.max - span.min);
  for (let index = 0; index < MARKS.blotches; index += 1) {
    const at = { x: random() * TILE, y: random() * TILE };
    const radius = pick(MARKS.blotchRadius);
    const color = RUST[Math.floor(random() ** 1.6 * RUST.length)];
    const alpha = 0.3 + random() * 0.4;
    const stretch = 0.4 + random() * 0.9;
    const turn = random() * Math.PI;
    // Drawn again across each edge it crosses, so the tile repeats without a seam.
    wrapped(at, radius, (x, y) => blotch(tile, { x, y }, { radius, color, alpha, stretch, turn, random }));
  }
  dots(tile, random, { count: MARKS.pits, radius: MARKS.pitRadius, color: CRUST, alpha: [0.3, 0.7], pick });
  dots(tile, random, { count: MARKS.flecks, radius: MARKS.fleckRadius, color: WORN, alpha: [0.2, 0.55], pick });
  tile.lineCap = "round";
  for (let index = 0; index < MARKS.scratches; index += 1) {
    const from = { x: random() * TILE, y: random() * TILE };
    const angle = random() * Math.PI * 2;
    const length = pick(MARKS.scratchLength);
    tile.strokeStyle = random() < 0.6 ? `rgba(255, 241, 198, ${(0.12 + random() * 0.22).toFixed(3)})` : `rgba(44, 20, 7, ${(0.25 + random() * 0.3).toFixed(3)})`;
    tile.lineWidth = 0.5 + random() * 0.8;
    tile.beginPath();
    tile.moveTo(from.x, from.y);
    tile.lineTo(from.x + Math.cos(angle) * length, from.y + Math.sin(angle) * length);
    tile.stroke();
  }
  return context.createPattern(/** @type {CanvasImageSource} */ (/** @type {unknown} */ (surface)), "repeat");
}

/**
 * A ragged patch of rust: a soft ellipse, frayed by smaller ones around its rim.
 * @param {OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D} tile
 * @param {{ x: number, y: number }} at
 * @param {{ radius: number, color: string, alpha: number, stretch: number, turn: number, random: () => number }} style
 */
function blotch(tile, at, { radius, color, alpha, stretch, turn, random }) {
  const lobes = 3 + Math.floor(random() * 4);
  for (let lobe = 0; lobe <= lobes; lobe += 1) {
    const angle = random() * Math.PI * 2;
    const reach = lobe === 0 ? 0 : radius * (0.4 + random() * 0.6);
    const center = { x: at.x + Math.cos(angle) * reach, y: at.y + Math.sin(angle) * reach * stretch };
    const size = lobe === 0 ? radius : radius * (0.25 + random() * 0.45);
    const gradient = tile.createRadialGradient(center.x, center.y, 0, center.x, center.y, size);
    gradient.addColorStop(0, withAlpha(color, alpha));
    gradient.addColorStop(0.6, withAlpha(color, alpha * 0.6));
    gradient.addColorStop(1, withAlpha(color, 0));
    tile.save();
    tile.translate(center.x, center.y);
    tile.rotate(turn);
    tile.scale(1, stretch);
    tile.translate(-center.x, -center.y);
    tile.fillStyle = gradient;
    tile.beginPath();
    tile.arc(center.x, center.y, size, 0, Math.PI * 2);
    tile.fill();
    tile.restore();
  }
}

/**
 * @param {OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D} tile
 * @param {() => number} random
 * @param {{ count: number, radius: { min: number, max: number }, color: string, alpha: [number, number], pick: (span: { min: number, max: number }) => number }} style
 */
function dots(tile, random, { count, radius, color, alpha, pick }) {
  for (let index = 0; index < count; index += 1) {
    tile.fillStyle = withAlpha(color, alpha[0] + random() * (alpha[1] - alpha[0]));
    tile.beginPath();
    tile.arc(random() * TILE, random() * TILE, pick(radius), 0, Math.PI * 2);
    tile.fill();
  }
}

/**
 * Calls `draw` at the point and at its copies across each edge of the tile it comes near.
 * @param {{ x: number, y: number }} at
 * @param {number} reach
 * @param {(x: number, y: number) => void} draw
 */
function wrapped(at, reach, draw) {
  const shifts = (/** @type {number} */ value) => [0, ...(value < reach * 2 ? [TILE] : []), ...(value > TILE - reach * 2 ? [-TILE] : [])];
  for (const dx of shifts(at.x)) {
    for (const dy of shifts(at.y)) {
      draw(at.x + dx, at.y + dy);
    }
  }
}

/**
 * An offscreen canvas of the given side, or null where there is none.
 * @param {number} side
 * @returns {OffscreenCanvas | HTMLCanvasElement | null}
 */
function makeSurface(side) {
  const Offscreen = globalThis.OffscreenCanvas;
  if (typeof Offscreen === "function") {
    return new Offscreen(side, side);
  }
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  return canvas;
}
