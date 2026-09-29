/**
 * The match log in the sidebar: every entry word-wrapped in full, with a
 * coloured bar and tint for its kind, turn starts in bold with a rule above.
 * It scrolls (wheel or drag); the scene owns a `LogScroll` so the position
 * survives rebuilds, and while it rests at the bottom it follows new entries.
 */
import { drawTextInRect, fillRoundedRect } from "../ui/drawing.js";
import { ScrollList } from "../ui/ScrollList.js";
import { UiNode } from "../ui/UiNode.js";
import { wrapText } from "../text/textUtils.js";
import { withAlpha } from "../theme/color.js";
import { fontFor } from "../theme/Theme.js";
import { LogKind } from "./eventLog.js";

const LINE_GAP = 4;
const ENTRY_GAP = 5;
const MARKER = Object.freeze({ width: 3, gap: 7 });
/** Older entries fade back so the newest stands out. */
const OLDER_ALPHA = 0.72;

/** @type {Readonly<Record<string, string>>} */
const KIND_COLORS = Object.freeze({
  [LogKind.TURN]: "accent",
  [LogKind.PLAY]: "resource",
  [LogKind.COMBAT]: "focus",
  [LogKind.DAMAGE]: "attack",
  [LogKind.LOSS]: "danger",
  [LogKind.HEAL]: "health",
  [LogKind.END]: "accentLight",
  [LogKind.REJECTED]: "danger",
});
/** @type {ReadonlySet<string>} */
const BOLD_KINDS = new Set([LogKind.TURN, LogKind.END]);

/**
 * Scroll position kept by the scene across rebuilds; `pinned` means "at the bottom, follow new entries".
 * @typedef {{ scrollY: number, pinned: boolean }} LogScroll
 * @typedef {{ entry: import("./eventLog.js").LogEntry, font: string, lines: string[], y: number, height: number }} LogRow
 */

/** @returns {LogScroll} */
export function createLogScroll() {
  return { scrollY: 0, pinned: true };
}

export class BattleLogNode extends ScrollList {
  /** @type {readonly import("./eventLog.js").LogEntry[]} */
  entries;
  /** @type {LogScroll} */
  #view;
  /** Wrapped rows, laid out on the first draw (wrapping needs the canvas to measure). @type {LogRow[] | null} */
  #rows = null;
  /** @type {UiNode} */
  #painter;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, entries: readonly import("./eventLog.js").LogEntry[], view?: LogScroll }} options
   */
  constructor(options) {
    super(options);
    this.entries = options.entries;
    this.#view = options.view ?? createLogScroll();
    this.#painter = this.add(new LogRows(() => this.#rows ?? []));
  }

  /** @param {number} offset */
  scrollTo(offset) {
    const changed = super.scrollTo(offset);
    this.#view.scrollY = this.scrollY;
    this.#view.pinned = this.scrollY >= this.maxScrollY;
    return changed;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  draw(context, theme) {
    if (!this.visible) {
      return;
    }
    if (this.#rows === null) {
      this.#rows = this.#layOut(context, theme);
      const last = this.#rows.at(-1);
      this.contentHeight = last === undefined ? 0 : last.y + last.height;
      this.#painter.width = this.rowWidth;
      this.#painter.height = this.contentHeight;
      this.scrollTo(this.#view.pinned ? this.maxScrollY : this.#view.scrollY);
    }
    super.draw(context, theme);
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @returns {LogRow[]}
   */
  #layOut(context, theme) {
    const lineHeight = theme.fonts.sizes.small + LINE_GAP;
    const textWidth = this.rowWidth - MARKER.width - MARKER.gap;
    const measure = (/** @type {string} */ text) => context.measureText(text).width;
    let y = 0;
    return this.entries.map((entry) => {
      const font = fontFor(theme, "small", BOLD_KINDS.has(entry.kind) ? "bold" : "normal");
      context.font = font;
      const lines = wrapText(measure, entry.text, textWidth);
      const row = { entry, font, lines, y, height: lines.length * lineHeight };
      y += row.height + ENTRY_GAP;
      return row;
    });
  }
}

/** Paints the laid-out rows inside the scrolled content. */
class LogRows extends UiNode {
  /** @type {() => readonly LogRow[]} */
  #rows;

  /** @param {() => readonly LogRow[]} rows */
  constructor(rows) {
    super();
    this.#rows = rows;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const rows = this.#rows();
    const textX = area.x + MARKER.width + MARKER.gap;
    const textWidth = area.width - MARKER.width - MARKER.gap;
    rows.forEach(({ entry, font, lines, y, height }, index) => {
      const top = area.y + y;
      const color = theme.colors[KIND_COLORS[entry.kind]] ?? theme.colors.text;
      const lineHeight = height / lines.length;
      context.save();
      context.globalAlpha = index === rows.length - 1 ? 1 : OLDER_ALPHA;
      if (entry.kind === LogKind.TURN && index > 0) {
        context.fillStyle = withAlpha(color, 0.35);
        context.fillRect(area.x, top - (ENTRY_GAP + 1) / 2, area.width, 1);
      }
      fillRoundedRect(context, { x: area.x, y: top + 2, width: MARKER.width, height: height - 4 }, { fill: color, radius: MARKER.width / 2 });
      lines.forEach((line, row) => {
        drawTextInRect(context, line, { x: textX, y: top + row * lineHeight, width: textWidth, height: lineHeight }, { font, color, align: "left" });
      });
      context.restore();
    });
  }
}
