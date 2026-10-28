/**
 * A line said at the table — a challenge character's, or a player's in the
 * chat of an online game (docs/tcg/28-chat.md): a speech bubble by the
 * speaker's seat (beside its HUD, or under the top seat's and over the
 * bottom seat's when there is no room beside), with the speaker's name and
 * their words. It fades in, stays a few seconds and fades out; it never
 * takes a click, so the game goes on under it. It waits while the coin is
 * tossed, so the opening line is not lost behind the toss.
 */
import { ellipsize, wrapText } from "../text/textUtils.js";
import { withAlpha } from "../theme/color.js";
import { fontFor } from "../theme/Theme.js";
import { drawTextInRect, fillRoundedRect, glowRoundedRect } from "../ui/drawing.js";

/** How long a line stays, and its fades, in ms. */
const LIFE_MS = 6000;
const FADE_MS = 300;
const MAX_LINES = 3;
/**
 * @typedef {Readonly<{ maxWidth: number, minWidth: number, padding: number, gap: number, tail: number, nameHeight: number, lineHeight: number, name: import("../theme/Theme.js").FontSize, text: import("../theme/Theme.js").FontSize }>} BubbleMetrics
 */
/** @type {BubbleMetrics} */
const WIDE = Object.freeze({ maxWidth: 440, minWidth: 220, padding: 14, gap: 14, tail: 10, nameHeight: 24, lineHeight: 24, name: "small", text: "body" });
/** @type {BubbleMetrics} */
const COMPACT = Object.freeze({ maxWidth: 260, minWidth: 150, padding: 8, gap: 8, tail: 7, nameHeight: 16, lineHeight: 16, name: "tiny", text: "tiny" });

export class SpeechBubble {
  /** @type {{ name: string, line: string, ageMs: number, lifeMs: number } | null} */
  #said = null;

  /**
   * A new line: it replaces the one showing.
   * @param {{ name: string, line: string, lifeMs?: number }} speech `lifeMs`: how long it stays (a few seconds when not said)
   */
  say({ name, line, lifeMs = LIFE_MS }) {
    this.#said = { name, line, ageMs: 0, lifeMs };
  }

  get isShowing() {
    return this.#said !== null;
  }

  /**
   * @param {number} dtMs
   * @param {boolean} waiting the line holds still (the coin is in the air)
   * @returns {boolean} whether it needs drawing again
   */
  update(dtMs, waiting) {
    const said = this.#said;
    if (said === null) {
      return false;
    }
    if (!waiting) {
      said.ageMs += dtMs;
    }
    if (said.ageMs >= said.lifeMs) {
      this.#said = null;
    }
    return true;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {{ seat: import("@magic8/engine/shared/geometry.js").Rect, stage: import("@magic8/engine/shared/geometry.js").Rect, compact: boolean, bottom?: boolean }} where
   *   `seat`: the speaker's HUD; `stage`: the screen the bubble keeps within; `bottom`: the seat is the bottom one (no room beside: the bubble goes over it)
   */
  paint(context, theme, { seat, stage, compact, bottom = false }) {
    const said = this.#said;
    if (said === null) {
      return;
    }
    const m = compact ? COMPACT : WIDE;
    const placed = place(m, seat, stage);
    context.save();
    context.font = fontFor(theme, m.text);
    const measure = (/** @type {string} */ text) => context.measureText(text).width;
    const textWidth = placed.width - 2 * m.padding;
    const lines = clip(measure, wrapText(measure, `“${said.line}”`, textWidth), textWidth);
    const height = 2 * m.padding + m.nameHeight + lines.length * m.lineHeight;
    const over = bottom && !placed.beside;
    const frame = { x: placed.x, y: over ? seat.y - m.gap - height : placed.y, width: placed.width, height };
    context.globalAlpha *= Math.max(0, Math.min(1, said.ageMs / FADE_MS, (said.lifeMs - said.ageMs) / FADE_MS));
    const radius = theme.spacing.radius;
    glowRoundedRect(context, frame, { color: withAlpha(theme.colors.accent, 0.45), radius, blur: 16, lineWidth: 1.5 });
    fillRoundedRect(context, frame, { fill: withAlpha(theme.colors.panelDark, 0.95), stroke: withAlpha(theme.colors.accent, 0.8), radius, lineWidth: 1.5 });
    paintTail(context, theme, { frame, towards: tailTowards(placed.beside, over), size: m.tail });
    const x = frame.x + m.padding;
    drawTextInRect(context, said.name, { x, y: frame.y + m.padding, width: textWidth, height: m.nameHeight }, { font: fontFor(theme, m.name, "bold"), color: theme.colors.accentLight, align: "left" });
    lines.forEach((text, index) => drawTextInRect(context, text, { x, y: frame.y + m.padding + m.nameHeight + index * m.lineHeight, width: textWidth, height: m.lineHeight }, { font: fontFor(theme, m.text), color: theme.colors.text, align: "left" }));
    context.restore();
  }
}

/**
 * Beside the seat when the screen has room for it there, else under it.
 * @param {BubbleMetrics} m
 * @param {import("@magic8/engine/shared/geometry.js").Rect} seat
 * @param {import("@magic8/engine/shared/geometry.js").Rect} stage
 */
function place(m, seat, stage) {
  const besideX = seat.x + seat.width + m.gap;
  const room = stage.x + stage.width - m.gap - besideX;
  if (room >= m.minWidth) {
    return { beside: true, x: besideX, y: seat.y, width: Math.min(m.maxWidth, room) };
  }
  return { beside: false, x: seat.x, y: seat.y + seat.height + m.gap, width: Math.min(m.maxWidth, stage.x + stage.width - m.gap - seat.x) };
}

/**
 * At most MAX_LINES lines, the last one cut with an ellipsis when the line is longer.
 * @param {(text: string) => number} measure
 * @param {string[]} lines
 * @param {number} width
 */
function clip(measure, lines, width) {
  if (lines.length <= MAX_LINES) {
    return lines;
  }
  const shown = lines.slice(0, MAX_LINES);
  shown[MAX_LINES - 1] = ellipsize(measure, lines.slice(MAX_LINES - 1).join(" "), width);
  return shown;
}

/**
 * Where the bubble points: left to a seat it is beside, down to the seat it is over, up to the seat it is under.
 * @param {boolean} beside
 * @param {boolean} over
 * @returns {"left" | "up" | "down"}
 */
function tailTowards(beside, over) {
  if (beside) {
    return "left";
  }
  return over ? "down" : "up";
}

/**
 * The bubble's point, towards the seat: out of its left side, its top, or its bottom.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {{ frame: import("@magic8/engine/shared/geometry.js").Rect, towards: "left" | "up" | "down", size: number }} tail
 */
function paintTail(context, theme, { frame, towards, size }) {
  context.beginPath();
  if (towards === "left") {
    const at = { x: frame.x, y: frame.y + size * 2.5 };
    context.moveTo(at.x + 1, at.y - size);
    context.lineTo(at.x - size, at.y);
    context.lineTo(at.x + 1, at.y + size);
  } else {
    // Out of the top (pointing up), or out of the bottom (pointing down).
    const sign = towards === "up" ? 1 : -1;
    const at = { x: frame.x + size * 4, y: towards === "up" ? frame.y : frame.y + frame.height };
    context.moveTo(at.x - size, at.y + sign);
    context.lineTo(at.x, at.y - sign * size);
    context.lineTo(at.x + size, at.y + sign);
  }
  context.closePath();
  context.fillStyle = withAlpha(theme.colors.panelDark, 0.95);
  context.fill();
  context.strokeStyle = withAlpha(theme.colors.accent, 0.8);
  context.lineWidth = 1.5;
  context.stroke();
}
