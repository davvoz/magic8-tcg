/**
 * The line icons of the navigation shell: the five sections, and the bar's notifications,
 * settings, Back and the lock of what is not available yet. Each is drawn
 * on a 24-unit grid, scaled into the box it is given, in one stroke colour;
 * pure drawing, no images to wait for.
 */

export const Icon = Object.freeze({
  HOME: "home",
  PLAY: "play",
  DECKS: "decks",
  MARKET: "market",
  SEASON: "season",
  BELL: "bell",
  SETTINGS: "settings",
  BACK: "back",
  LOCK: "lock",
  /** Watching a game. */
  EYE: "eye",
  /** Games played, to look back on. */
  HISTORY: "history",
  /** Practice: a target. */
  TARGET: "target",
  /** Learning the game: an open book. */
  BOOK: "book",
});

const GRID = 24;
/** The stroke's width on the grid, before scaling: thin enough for the small rail of a phone. */
const STROKE = 1.8;

/**
 * Draws the paths of one icon on the grid; `pen` maps grid points to the box.
 * @typedef {(pen: Pen) => void} IconPainter
 * @typedef {{
 *   move: (x: number, y: number) => void,
 *   line: (x: number, y: number) => void,
 *   arc: (x: number, y: number, radius: number, sweep: { from: number, to: number, counter?: boolean }) => void,
 *   close: () => void,
 *   stroke: () => void,
 *   dot: (x: number, y: number, radius: number) => void,
 * }} Pen
 */

const HALF_TURN = Math.PI;
const QUARTER_TURN = Math.PI / 2;

/** @type {Readonly<Record<string, IconPainter>>} */
const PAINTERS = Object.freeze({
  [Icon.HOME]: (pen) => {
    pen.move(3, 11);
    pen.line(12, 3.5);
    pen.line(21, 11);
    pen.move(5.5, 9.5);
    pen.line(5.5, 20.5);
    pen.line(18.5, 20.5);
    pen.line(18.5, 9.5);
    pen.move(10, 20.5);
    pen.line(10, 14.5);
    pen.line(14, 14.5);
    pen.line(14, 20.5);
    pen.stroke();
  },
  [Icon.PLAY]: (pen) => {
    // Two crossed swords: blade, guard, grip.
    for (const side of [1, -1]) {
      const x = (/** @type {number} */ value) => (side === 1 ? value : GRID - value);
      pen.move(x(4), 3.5);
      pen.line(x(15.5), 15);
      pen.move(x(12.5), 17.5);
      pen.line(x(17.5), 12.5);
      pen.move(x(15.5), 15);
      pen.line(x(20), 19.5);
    }
    pen.stroke();
  },
  [Icon.DECKS]: (pen) => {
    pen.move(10, 3.5);
    pen.line(19.5, 3.5);
    pen.line(19.5, 17);
    pen.line(10, 17);
    pen.close();
    // The card behind shows along the front one's left and foot.
    pen.move(7, 6.5);
    pen.line(7, 20);
    pen.line(16.5, 20);
    pen.move(4.5, 9.5);
    pen.line(4.5, 22);
    pen.line(13, 22);
    pen.stroke();
  },
  [Icon.MARKET]: (pen) => {
    pen.move(5, 8);
    pen.line(19, 8);
    pen.line(18, 21);
    pen.line(6, 21);
    pen.close();
    pen.move(9, 10);
    pen.line(9, 6.5);
    pen.arc(12, 6.5, 3, { from: HALF_TURN, to: 0 });
    pen.line(15, 10);
    pen.stroke();
  },
  [Icon.SEASON]: (pen) => {
    pen.move(7, 3.5);
    pen.line(17, 3.5);
    pen.line(17, 9);
    pen.arc(12, 9, 5, { from: 0, to: HALF_TURN });
    pen.close();
    pen.move(7, 5.5);
    pen.line(3.5, 5.5);
    pen.arc(7, 5.5, 3.5, { from: HALF_TURN, to: QUARTER_TURN, counter: true });
    pen.move(17, 5.5);
    pen.line(20.5, 5.5);
    pen.arc(17, 5.5, 3.5, { from: 0, to: QUARTER_TURN });
    pen.move(12, 14);
    pen.line(12, 18.5);
    pen.move(8, 20.5);
    pen.line(16, 20.5);
    pen.stroke();
  },
  [Icon.BELL]: (pen) => {
    pen.move(6, 16.5);
    pen.line(6, 10.5);
    pen.arc(12, 10.5, 6, { from: HALF_TURN, to: 0 });
    pen.line(18, 16.5);
    pen.line(20, 18.5);
    pen.line(4, 18.5);
    pen.close();
    pen.move(10, 21);
    pen.line(14, 21);
    pen.stroke();
  },
  [Icon.SETTINGS]: (pen) => {
    for (const [y, knob] of [[6.5, 9], [12, 15.5], [17.5, 7.5]]) {
      pen.move(3.5, y);
      pen.line(knob - 2.2, y);
      pen.move(knob + 2.2, y);
      pen.line(20.5, y);
      pen.stroke();
      pen.dot(knob, y, 2.2);
    }
  },
  [Icon.BACK]: (pen) => {
    pen.move(14.5, 5);
    pen.line(7.5, 12);
    pen.line(14.5, 19);
    pen.stroke();
  },
  [Icon.EYE]: (pen) => {
    pen.move(2.5, 12);
    pen.arc(12, 20, 11.5, { from: Math.PI + 0.77, to: -0.77 });
    pen.arc(12, 4, 11.5, { from: 0.77, to: Math.PI - 0.77 });
    pen.stroke();
    pen.dot(12, 12, 3);
  },
  [Icon.HISTORY]: (pen) => {
    pen.move(4.5, 7.5);
    pen.arc(12, 12, 8.5, { from: Math.PI + 0.55, to: Math.PI + 0.54, counter: false });
    pen.move(4.5, 3.5);
    pen.line(4.5, 7.5);
    pen.line(8.5, 7.5);
    pen.move(12, 7.5);
    pen.line(12, 12);
    pen.line(15, 14);
    pen.stroke();
  },
  [Icon.TARGET]: (pen) => {
    pen.dot(12, 12, 8.5);
    pen.dot(12, 12, 4.5);
    pen.dot(12, 12, 0.8);
  },
  [Icon.BOOK]: (pen) => {
    pen.move(12, 6.5);
    pen.line(12, 20);
    pen.move(12, 6.5);
    pen.line(7, 4.5);
    pen.line(3, 5.5);
    pen.line(3, 18.5);
    pen.line(7, 17.5);
    pen.line(12, 20);
    pen.line(17, 17.5);
    pen.line(21, 18.5);
    pen.line(21, 5.5);
    pen.line(17, 4.5);
    pen.line(12, 6.5);
    pen.stroke();
  },
  [Icon.LOCK]: (pen) => {
    pen.move(6, 11);
    pen.line(18, 11);
    pen.line(18, 21);
    pen.line(6, 21);
    pen.close();
    pen.move(8.5, 11);
    pen.line(8.5, 8);
    pen.arc(12, 8, 3.5, { from: HALF_TURN, to: 0 });
    pen.line(15.5, 11);
    pen.stroke();
  },
});

/**
 * Draws an icon in a square box.
 * @param {CanvasRenderingContext2D} context
 * @param {string} icon one of Icon
 * @param {{ x: number, y: number, size: number, color: string }} box `x`, `y`: the box's top-left corner
 */
export function drawIcon(context, icon, { x, y, size, color }) {
  const painter = PAINTERS[icon];
  if (painter === undefined) {
    return;
  }
  const unit = size / GRID;
  const at = (/** @type {number} */ value) => value * unit;
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = Math.max(1, STROKE * unit);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  /** @type {Pen} */
  const pen = {
    move: (px, py) => context.moveTo(x + at(px), y + at(py)),
    line: (px, py) => context.lineTo(x + at(px), y + at(py)),
    arc: (px, py, radius, { from, to, counter = false }) => context.arc(x + at(px), y + at(py), at(radius), from, to, counter),
    close: () => context.closePath(),
    stroke: () => {
      context.stroke();
      context.beginPath();
    },
    dot: (px, py, radius) => {
      context.beginPath();
      context.arc(x + at(px), y + at(py), at(radius), 0, 2 * Math.PI);
      context.stroke();
      context.beginPath();
    },
  };
  painter(pen);
  context.restore();
}

/** Whether there is an icon by this name. @param {string} icon */
export function hasIcon(icon) {
  return PAINTERS[icon] !== undefined;
}
