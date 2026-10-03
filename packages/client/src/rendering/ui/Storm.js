/**
 * The storm gathering in the painted menu backdrop. Every so often one of
 * the storm cells painted in it wakes: a thin bolt grows out of its cloud
 * along the painted lightning, flashes once or twice and fades, while the
 * cloud around it brightens faintly and the painting near it catches the
 * light — its gold lines glint, its clouds pale, and the gold figures on its
 * rim gleam, those nearest the strike the most — a storm still on its way,
 * never overhead.
 * Strikes are rare, short and one at a time.
 *
 * Presentation state only: time is fed in by the game loop (`update`), and
 * the shape of each strike and the pause before it come from the seed, so
 * the same seed plays the same storm. Frames are asked for only while a
 * strike moves on a screen that shows it: between strikes nothing is
 * redrawn for it, nor is a screen that does not draw it (the match).
 */
import { Easing } from "../animation/Tween.js";
import { withAlpha } from "../theme/color.js";
import { glint, onPainting, randomStream } from "./backdropLight.js";
import { radialGradient } from "./drawing.js";

/**
 * @typedef {import("./backdropLight.js").Painting} Painting
 * @typedef {import("./backdropLight.js").BackdropLight} BackdropLight
 * @typedef {Readonly<{ x: number, y: number, angle: number, length: number }>} StormCell a cloud
 *   with lightning painted in it: its centre as fractions of the painting, the way its bolts
 *   run (degrees clockwise from rightwards, 90 straight down) and how far they reach (a
 *   fraction of the painting's width)
 * @typedef {Readonly<{ x: number, y: number, radius: number }>} StormFigure a gold figure on the
 *   painting's rim that gleams when lightning strikes near it: its centre as fractions of the
 *   painting, its radius as a fraction of its width
 * @typedef {Readonly<{ firstMs: number, pauseMs: Readonly<{ min: number, max: number }>, growMs: number, flashMs: number, fadeMs: number }>} StormTiming
 *   `firstMs`: the quiet before the first strike; `pauseMs`: between strikes; then each
 *   strike's phases: the bolt growing, its flash, its fading
 * @typedef {{ x: number, y: number, at: number }} BoltPoint offsets from the cell's centre in
 *   painting widths; `at`: how far the growing bolt must have reached for the point to show
 * @typedef {{ cell: StormCell, paths: { points: BoltPoint[], weight: number }[], reach: number, strength: number, flicker: number, elapsedMs: number }} Strike
 */

/** @type {StormTiming} */
export const STORM_TIMING = Object.freeze({ firstMs: 2500, pauseMs: Object.freeze({ min: 7000, max: 15000 }), growMs: 420, flashMs: 260, fadeMs: 1100 });

/** How bright the bolt is while it grows, before the flash (1 is the flash's peak). */
const LEADER = 0.3;
/** How bright it is as the flash ends and the fading starts. */
const AFTERGLOW = 0.7;
/** Opacity at full brightness: the thin core, the soft glow around it, the light in the cloud, the painting's glint at its brightest. */
const ALPHA = Object.freeze({ core: 0.75, glow: 0.16, cloud: 0.09, glint: 0.45, figure: 0.85 });
/** Line widths as fractions of the painting's width. */
const WIDTH = Object.freeze({ core: 0.0011, glow: 0.007 });
/** The cloud's light reaches this far, in bolt lengths. */
const CLOUD_REACH = 0.7;
/**
 * The painting catches the light this far from the cloud's centre (in bolt
 * lengths), fading out in this many steps: each a disc of the painting laid
 * over itself, so only what is bright in it — the gold, the clouds — lights up.
 */
const GLINT = Object.freeze({ reach: 2, steps: 8 });
/**
 * Every rim figure catches some of a flash (`far`); one nearer a strike than
 * `reach` (in painting widths) catches more of it, all of it right beside it.
 */
const FIGURE_LIGHT = Object.freeze({ far: 0.3, reach: 0.55 });
/** A bolt starts this far behind its cloud's centre (in bolt lengths), so it crosses the cloud. */
const BACKSET = 0.45;
/** How far a bolt may turn from its cell's direction, in degrees. */
const ANGLE_JITTER = 12;
/** The jaggedness of a bolt: the first sideways kick (in bolt lengths) and how much each finer level keeps of it. */
const ROUGHNESS = Object.freeze({ start: 0.12, decay: 0.55 });
const LEVELS = Object.freeze({ main: 5, branch: 4 });
const DEGREES = Math.PI / 180;

/** @implements {BackdropLight} */
export class Storm {
  #cells;
  #figures;
  #timing;
  #random;
  #waitMs;
  /** @type {Strike | null} */
  #strike = null;
  #lastCell = -1;
  /** Whether the last frame drawn showed the storm. */
  #shown = false;

  /**
   * @param {{ cells: readonly StormCell[], figures?: readonly StormFigure[], seed?: string, timing?: StormTiming }} options
   */
  constructor({ cells, figures = [], seed = "storm", timing = STORM_TIMING }) {
    this.#cells = cells;
    this.#figures = figures;
    this.#timing = timing;
    this.#random = randomStream(seed);
    this.#waitMs = timing.firstMs;
  }

  get isStriking() {
    return this.#strike !== null;
  }

  /**
   * @param {number} dtMs
   * @returns {boolean} whether a frame is needed: a strike moved (or just ended) on a screen that shows it
   */
  update(dtMs) {
    if (this.#cells.length === 0) {
      return false;
    }
    const strike = this.#strike;
    if (strike === null) {
      this.#waitMs -= dtMs;
      if (this.#waitMs > 0) {
        return false;
      }
      this.#strike = this.#newStrike();
    } else {
      strike.elapsedMs += dtMs;
      if (strike.elapsedMs >= this.#durationMs) {
        this.#strike = null;
        this.#waitMs = this.#between(this.#timing.pauseMs.min, this.#timing.pauseMs.max);
      }
    }
    // Drawing it again marks it shown again; a screen that stopped drawing it stops being asked for frames.
    const wanted = this.#shown;
    this.#shown = false;
    return wanted;
  }

  /**
   * Over the painting and what tints it.
   * @param {CanvasRenderingContext2D} context
   * @param {Readonly<Record<string, string>>} colors the theme's colours
   * @param {Painting} painting
   */
  draw(context, colors, painting) {
    this.#shown = true;
    const strike = this.#strike;
    if (strike === null) {
      return;
    }
    const level = this.#brightness(strike) * strike.strength;
    const unit = painting.width;
    const center = onPainting(painting, strike.cell);
    context.save();
    context.globalCompositeOperation = "lighter";
    if (painting.image !== undefined) {
      // Only the flash makes the painting glint: barely while the bolt grows.
      const light = level * level;
      glint(context, painting.image, painting, { center, radius: strike.cell.length * unit * GLINT.reach, alpha: ALPHA.glint * light, steps: GLINT.steps });
      for (const figure of this.#figures) {
        const at = onPainting(painting, figure);
        const near = Math.max(0, 1 - Math.hypot(at.x - center.x, at.y - center.y) / (FIGURE_LIGHT.reach * unit));
        const share = FIGURE_LIGHT.far + (1 - FIGURE_LIGHT.far) * near;
        glint(context, painting.image, painting, { center: at, radius: figure.radius * unit, alpha: ALPHA.figure * light * share, steps: GLINT.steps });
      }
    }
    const cloud = strike.cell.length * unit * CLOUD_REACH;
    context.fillStyle = radialGradient(context, center, cloud, [
      [0, withAlpha(colors.text, ALPHA.cloud * level)],
      [1, withAlpha(colors.text, 0)],
    ]);
    context.fillRect(center.x - cloud, center.y - cloud, cloud * 2, cloud * 2);
    context.lineCap = "round";
    context.lineJoin = "round";
    const reached = Easing.easeOutCubic(Math.min(1, strike.elapsedMs / this.#timing.growMs)) * strike.reach;
    for (const { points, weight } of strike.paths) {
      traceBolt(context, points, { reached, center, unit });
      context.lineWidth = WIDTH.glow * unit * weight;
      context.strokeStyle = withAlpha(colors.accent, ALPHA.glow * level * weight);
      context.stroke();
      context.lineWidth = WIDTH.core * unit * weight;
      context.strokeStyle = withAlpha(colors.accentLight, ALPHA.core * level * weight);
      context.stroke();
    }
    context.restore();
  }

  get #durationMs() {
    const { growMs, flashMs, fadeMs } = this.#timing;
    return growMs + flashMs + fadeMs;
  }

  /**
   * Faint while it grows, then a flash (a second, weaker one if the strike flickers), then fading out.
   * @param {Strike} strike
   */
  #brightness(strike) {
    const { growMs, flashMs, fadeMs } = this.#timing;
    if (strike.elapsedMs < growMs) {
      return LEADER;
    }
    const flash = strike.elapsedMs - growMs;
    if (flash < flashMs) {
      return interpolate(flash / flashMs, [[0, LEADER], [0.15, 1], [0.5, 0.4], [0.7, strike.flicker], [1, AFTERGLOW]]);
    }
    return AFTERGLOW * (1 - Math.min(1, (flash - flashMs) / Math.max(1, fadeMs))) ** 2;
  }

  /** @returns {Strike} a strike in a different cell from the last one */
  #newStrike() {
    const count = this.#cells.length;
    let index = Math.min(count - 1, Math.floor(this.#random() * (this.#lastCell < 0 ? count : count - 1)));
    if (this.#lastCell >= 0 && count > 1 && index >= this.#lastCell) {
      index += 1;
    }
    this.#lastCell = index;
    const cell = this.#cells[index];
    const angle = (cell.angle + this.#between(-ANGLE_JITTER, ANGLE_JITTER)) * DEGREES;
    const length = cell.length * this.#between(0.75, 1);
    const start = { x: -Math.cos(angle) * length * BACKSET, y: -Math.sin(angle) * length * BACKSET, at: 0 };
    const main = this.#bolt({ start, angle, length, levels: LEVELS.main, span: 1 });
    const paths = [{ points: main, weight: 1 }];
    const branches = this.#random() < 0.5 ? 1 : 2;
    for (let branch = 0; branch < branches; branch += 1) {
      const fork = main[Math.floor(this.#between(0.25, 0.65) * (main.length - 1))];
      const side = this.#random() < 0.5 ? -1 : 1;
      const share = this.#between(0.25, 0.45);
      paths.push({ points: this.#bolt({ start: fork, angle: angle + side * this.#between(0.4, 0.75), length: length * share, levels: LEVELS.branch, span: share }), weight: 0.6 });
    }
    const reach = Math.max(...paths.flatMap(({ points }) => points.map((point) => point.at)));
    return { cell, paths, reach, strength: this.#between(0.65, 1), flicker: this.#between(0.4, 0.85), elapsedMs: 0 };
  }

  /**
   * A jagged line by midpoint displacement: each level splits every segment
   * and kicks its middle sideways, less at each finer level.
   * @param {{ start: BoltPoint, angle: number, length: number, levels: number, span: number }} shape `span`: how much of the strike's growth it takes
   * @returns {BoltPoint[]}
   */
  #bolt({ start, angle, length, levels, span }) {
    /** @type {{ u: number, v: number }[]} along and across the bolt, in its lengths */
    let line = [{ u: 0, v: 0 }, { u: 1, v: 0 }];
    let kick = ROUGHNESS.start;
    for (let level = 0; level < levels; level += 1) {
      line = line.flatMap((point, index) => {
        const next = line[index + 1];
        return next === undefined ? [point] : [point, { u: (point.u + next.u) / 2, v: (point.v + next.v) / 2 + this.#between(-kick, kick) }];
      });
      kick *= ROUGHNESS.decay;
    }
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return line.map(({ u, v }) => ({ x: start.x + (u * cos - v * sin) * length, y: start.y + (u * sin + v * cos) * length, at: start.at + u * span }));
  }

  /**
   * @param {number} min
   * @param {number} max
   */
  #between(min, max) {
    return min + this.#random() * (max - min);
  }
}

/**
 * The path of the part of a bolt grown so far, its tip partway along its last segment.
 * @param {CanvasRenderingContext2D} context
 * @param {BoltPoint[]} points
 * @param {{ reached: number, center: { x: number, y: number }, unit: number }} frame
 */
function traceBolt(context, points, { reached, center, unit }) {
  /** @param {number} x @param {number} y */
  const lineTo = (x, y) => context.lineTo(center.x + x * unit, center.y + y * unit);
  context.beginPath();
  context.moveTo(center.x + points[0].x * unit, center.y + points[0].y * unit);
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (to.at <= reached) {
      lineTo(to.x, to.y);
      continue;
    }
    const part = Math.max(0, (reached - from.at) / (to.at - from.at));
    lineTo(from.x + (to.x - from.x) * part, from.y + (to.y - from.y) * part);
    return;
  }
}

/**
 * @param {number} t 0..1
 * @param {readonly (readonly [number, number])[]} keys `[t, value]`, in order
 */
function interpolate(t, keys) {
  for (let index = 1; index < keys.length; index += 1) {
    const [toT, toValue] = keys[index];
    const [fromT, fromValue] = keys[index - 1];
    if (t <= toT) {
      return fromValue + ((toValue - fromValue) * (t - fromT)) / (toT - fromT);
    }
  }
  return keys[keys.length - 1][1];
}
