/**
 * The decision clock: a small round dial docked in the banner's unused
 * margin, ticking down to the current decision's deadline (docs/tcg/02
 * §3.7). A depleting ring shows how much time is left, colour shifting from
 * calm to urgent as it runs low; the time itself is spelled out as mm:ss in
 * the centre. Drawn, never read from — MatchScene decides when a deadline
 * exists at all (only online matches are timed).
 */
import { withAlpha } from "../theme/color.js";
import { fontFor } from "../theme/Theme.js";
import { drawOutlinedText } from "../ui/drawing.js";
import { UiNode } from "../ui/UiNode.js";

/** The ring reads full at this many ms left; a cosmetic reference, not the server's real budget (which varies by decision). */
const RING_REFERENCE_MS = 120_000;
const WARN_MS = 20_000;
const CRITICAL_MS = 10_000;
const RING_WIDTH = 4;
const START_ANGLE = -Math.PI / 2;

export class ClockNode extends UiNode {
  /** @type {() => import("../../application/online/RemoteMatchSession.js").MatchClock | null} */
  #clock;
  /** @type {() => number} */
  #now;

  /**
   * @param {{ x: number, y: number, size: number, clock: () => import("../../application/online/RemoteMatchSession.js").MatchClock | null, now: () => number }} options
   *   `clock`/`now` are read at paint time, so the dial ticks without a tree rebuild.
   */
  constructor({ x, y, size, clock, now }) {
    super({ x, y, width: size, height: size });
    this.passthrough = true;
    this.#clock = clock;
    this.#now = now;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const remaining = this.#remainingMs();
    if (remaining === null) {
      return;
    }
    const { colors } = theme;
    const area = this.bounds;
    const centerX = area.x + area.width / 2;
    const centerY = area.y + area.height / 2;
    const radius = area.width / 2;
    const urgency = urgencyColorFor(colors, remaining);
    const fraction = Math.max(0, Math.min(1, remaining / RING_REFERENCE_MS));
    const sweep = START_ANGLE + fraction * Math.PI * 2;

    context.save();
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.fillStyle = withAlpha(colors.panelDark, 0.88);
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = withAlpha(colors.panelBorder, 0.8);
    context.stroke();

    if (remaining <= CRITICAL_MS) {
      context.shadowColor = withAlpha(urgency, 0.9);
      context.shadowBlur = 10;
    }
    context.lineWidth = RING_WIDTH;
    context.strokeStyle = urgency;
    context.lineCap = "round";
    context.beginPath();
    context.arc(centerX, centerY, radius - RING_WIDTH, START_ANGLE, sweep);
    context.stroke();
    context.restore();

    drawOutlinedText(context, formatClock(remaining), area, { font: fontFor(theme, "small", "bold"), color: urgency, outline: withAlpha(colors.letterbox, 0.85), outlineWidth: 2 });
  }

  /** Time left on the active decision, or null when there is none to show. */
  #remainingMs() {
    const clock = this.#clock();
    if (clock === null || clock.deadline === null) {
      return null;
    }
    return Math.max(0, clock.deadline - this.#now());
  }
}

/**
 * Green with plenty of time, orange once it is getting short, red once it is critical.
 * @param {Readonly<Record<string, string>>} colors
 * @param {number} remaining
 */
function urgencyColorFor(colors, remaining) {
  if (remaining <= CRITICAL_MS) {
    return colors.danger;
  }
  return remaining <= WARN_MS ? colors.attack : colors.health;
}

/** "1:05"; never negative. @param {number} ms */
function formatClock(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
