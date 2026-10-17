/**
 * Base of the Home screen's cards: a panel that lays its parts from the top
 * down — a small coloured kicker ("TODAY'S CHALLENGE"), a title, a few
 * lines — and its buttons along its foot, with a note over them. A button
 * that cannot be used yet stays where it is, locked, and the note says why.
 * Wide and compact (a phone) metrics.
 */
import { Button } from "../../ui/Button.js";
import { Icon } from "../../ui/icons.js";
import { IconButton } from "../../ui/IconButton.js";
import { Label } from "../../ui/Label.js";
import { Panel, PANEL_INSET, SMALL_PANEL_INSET } from "../../ui/Panel.js";
import { TextBlock } from "../../ui/TextBlock.js";

/**
 * @typedef {Readonly<{
 *   inset: number, gap: number, kicker: number, title: number, line: number, button: number, note: number,
 *   sizes: Readonly<{ kicker: import("../../theme/Theme.js").FontSize, title: import("../../theme/Theme.js").FontSize, text: import("../../theme/Theme.js").FontSize, note: import("../../theme/Theme.js").FontSize }>,
 * }>} CardMetrics `line`: a text line's height; `note`: the line over the buttons
 */
/** @type {Readonly<{ wide: CardMetrics, compact: CardMetrics }>} */
export const CARD_METRICS = Object.freeze({
  wide: Object.freeze({ inset: PANEL_INSET, gap: 8, kicker: 22, title: 44, line: 26, button: 56, note: 24, sizes: Object.freeze({ kicker: "small", title: "heading", text: "body", note: "small" }) }),
  compact: Object.freeze({ inset: SMALL_PANEL_INSET, gap: 4, kicker: 16, title: 26, line: 16, button: 46, note: 16, sizes: Object.freeze({ kicker: "tiny", title: "body", text: "tiny", note: "tiny" }) }),
});

/**
 * A button along a card's foot.
 * @typedef {Readonly<{ id: string, text: string, onActivate: () => void, variant?: import("../../ui/Button.js").ButtonVariant, enabled?: boolean, locked?: boolean }>} CardAction
 *   `locked`: not available yet (disabled, with a lock)
 */

export class HomeCard extends Panel {
  /** @type {CardMetrics} */
  metrics;
  compact;
  /** Where the parts start from the card's left: its inset, or past what the card keeps on its left (a picture). */
  left;
  /** Where the next part goes, from the top. */
  #cursor;

  /**
   * @param {{ id: string, x: number, y: number, width: number, height: number, compact: boolean, glowKey?: string | null, lead?: number }} options
   *   `lead`: the room kept on the card's left for something of its own (a picture), before the inset
   */
  constructor({ compact, glowKey = null, lead = 0, ...frame }) {
    super({ ...frame, smallCorners: compact, glowKey });
    this.compact = compact;
    this.metrics = compact ? CARD_METRICS.compact : CARD_METRICS.wide;
    this.left = lead + this.metrics.inset;
    this.#cursor = this.metrics.inset;
  }

  /** The width the parts have: inside the card's insets, past its lead. */
  get inner() {
    return this.width - this.left - this.metrics.inset;
  }

  /** Where the next part goes. */
  get cursor() {
    return this.#cursor;
  }

  /** @param {number} height the room a part took, the gap after it included */
  advance(height) {
    this.#cursor += height;
  }

  /**
   * @param {string} text
   * @param {string} [colorKey]
   */
  addKicker(text, colorKey = "accent") {
    const { kicker, gap, sizes } = this.metrics;
    this.add(new Label({ x: this.left, y: this.#cursor, width: this.inner, height: kicker, text: text.toUpperCase(), size: sizes.kicker, weight: "bold", colorKey, align: "left", fit: true }));
    this.advance(kicker + gap);
  }

  /**
   * @param {string} text
   * @param {{ id?: string, colorKey?: string }} [options]
   */
  addTitle(text, { id, colorKey = "accentLight" } = {}) {
    const { title, sizes } = this.metrics;
    this.add(new Label({ id, x: this.left, y: this.#cursor, width: this.inner, height: title, text, size: sizes.title, weight: "bold", colorKey, align: "left", fit: true }));
    this.advance(title);
  }

  /**
   * @param {string} text
   * @param {{ id?: string, lines?: number, colorKey?: string }} [options] `lines`: the most it may take
   */
  addText(text, { id, lines = 2, colorKey = "text" } = {}) {
    const { line, gap, sizes } = this.metrics;
    const height = Math.max(line, Math.min(lines * line + 4, this.footTop - this.#cursor - gap));
    this.add(new TextBlock({ id, x: this.left, y: this.#cursor, width: this.inner, height, text, size: sizes.text, colorKey }));
    this.advance(height + gap);
  }

  /**
   * The buttons side by side along the foot, the note (when there is one) over them.
   * @param {readonly CardAction[]} actions
   * @param {{ note?: string | null, noteId?: string, noteKey?: string }} [options]
   * @returns {Button[]}
   */
  addActions(actions, { note = null, noteId, noteKey = "textMuted" } = {}) {
    const { inset, gap, button, sizes } = this.metrics;
    const y = this.height - inset - button;
    if (note !== null) {
      this.add(new Label({ id: noteId, x: this.left, y: y - this.metrics.note - gap, width: this.inner, height: this.metrics.note, text: note, size: sizes.note, colorKey: noteKey, align: "left", fit: true }));
    }
    const spacing = this.compact ? 8 : 14;
    const width = (this.inner - (actions.length - 1) * spacing) / actions.length;
    return actions.map((action, index) => {
      const frame = { id: action.id, x: this.left + index * (width + spacing), y, width, height: button, variant: action.variant ?? "secondary", enabled: action.enabled !== false && action.locked !== true, onActivate: action.onActivate, keepPlate: true };
      return this.add(action.locked === true ? new IconButton({ ...frame, icon: Icon.LOCK, caption: action.text }) : new Button({ ...frame, text: action.text, textSize: this.compact ? "small" : "body" }));
    });
  }

  /** Where the parts above the foot (the buttons and the note over them) must end. */
  get footTop() {
    const { inset, button, note, gap } = this.metrics;
    return this.height - inset - button - note - 2 * gap;
  }
}
