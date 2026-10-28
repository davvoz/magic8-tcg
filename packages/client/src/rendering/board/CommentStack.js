/**
 * What those watching say (docs/tcg/28-chat.md), as everyone at the table
 * sees it: speech bubbles stacked down from a corner of the table, the
 * newest at the bottom, a few at a time; each fades out on its own, like a
 * player's line by their seat. A spectator has no seat, so the bubbles
 * point at nobody.
 */
import { SpeechBubble } from "./SpeechBubble.js";

/** Comments on the table at once; a new one pushes the oldest off. */
const MAX_SHOWN = 3;
/** The bubbles' width, and the room between two, on a wide and on a compact board. */
const WIDE = Object.freeze({ width: 380, gap: 8 });
const COMPACT = Object.freeze({ width: 240, gap: 5 });

export class CommentStack {
  /** Oldest first. @type {SpeechBubble[]} */
  #bubbles = [];

  /** @param {{ name: string, line: string }} comment */
  say(comment) {
    const bubble = new SpeechBubble();
    bubble.say(comment);
    this.#bubbles = [...this.#bubbles, bubble].slice(-MAX_SHOWN);
  }

  get isShowing() {
    return this.#bubbles.length > 0;
  }

  /**
   * @param {number} dtMs
   * @param {boolean} waiting the comments hold still (the coin is in the air)
   * @returns {boolean} whether they need drawing again
   */
  update(dtMs, waiting) {
    const changed = this.#bubbles.map((bubble) => bubble.update(dtMs, waiting)).some(Boolean);
    this.#bubbles = this.#bubbles.filter((bubble) => bubble.isShowing);
    return changed;
  }

  /**
   * Down from the top-right corner of `area`, oldest first.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {{ area: import("@magic8/engine/shared/geometry.js").Rect, compact: boolean }} where
   */
  paint(context, theme, { area, compact }) {
    const m = compact ? COMPACT : WIDE;
    const width = Math.min(m.width, area.width);
    const x = area.x + area.width - width;
    let top = area.y;
    for (const bubble of this.#bubbles) {
      top += bubble.paintAt(context, theme, { x, top, width, compact }) + m.gap;
    }
  }
}
