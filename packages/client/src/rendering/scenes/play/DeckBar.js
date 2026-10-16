/**
 * The deck the player plays with, across the top of the Play screen: its
 * name, size and faction mix (striped), and Change, which lets them pick
 * another. Without a deck to play, the way to get one instead.
 */
import { Button } from "../../ui/Button.js";
import { Label } from "../../ui/Label.js";
import { Panel, SMALL_PANEL_INSET } from "../../ui/Panel.js";
import { UiNode } from "../../ui/UiNode.js";
import { fillRoundedRect } from "../../ui/drawing.js";

const WIDE = Object.freeze({ inset: 24, label: 110, stripe: 8, button: Object.freeze({ width: 200, height: 46 }), sizes: Object.freeze({ label: "small", name: "body", summary: "small" }) });
const COMPACT = Object.freeze({ inset: SMALL_PANEL_INSET, label: 0, stripe: 6, button: Object.freeze({ width: 110, height: 46 }), sizes: Object.freeze({ label: "tiny", name: "small", summary: "tiny" }) });

/**
 * @typedef {Readonly<{ name: string, summary: string, bands: readonly { color: string, weight: number }[] }>} ShownDeck
 * @typedef {Readonly<{ id: string, text: string, onActivate: () => void, enabled?: boolean }>} DeckBarAction
 */

export class DeckBar extends Panel {
  /**
   * @param {{ id: string, x: number, y: number, width: number, height: number, compact: boolean, deck: ShownDeck | null, empty: string, action: DeckBarAction }} options
   *   `empty`: what stands for the deck when there is none to play; `action`: Change, or the way to get a deck
   */
  constructor({ compact, deck, empty, action, ...frame }) {
    super({ ...frame, smallCorners: true });
    const m = compact ? COMPACT : WIDE;
    const buttonX = frame.width - m.inset - m.button.width;
    let x = m.inset;
    if (m.label > 0) {
      this.add(new Label({ x, y: 0, width: m.label, height: frame.height, text: "Your deck", size: m.sizes.label, colorKey: "textMuted", align: "left" }));
      x += m.label;
    }
    if (deck !== null) {
      this.add(new Stripe({ x, y: (frame.height - 2 * m.stripe * 3) / 2, width: m.stripe, height: 6 * m.stripe, bands: deck.bands }));
      x += m.stripe + 12;
    }
    const width = buttonX - x - 12;
    const nameHeight = compact ? frame.height / 2 : frame.height * 0.55;
    this.add(new Label({ id: `${frame.id}.name`, x, y: compact ? 2 : 4, width, height: nameHeight, text: deck?.name ?? empty, size: m.sizes.name, weight: "bold", colorKey: deck === null ? "textMuted" : "accentLight", align: "left", fit: true }));
    if (deck !== null) {
      this.add(new Label({ id: `${frame.id}.summary`, x, y: nameHeight - (compact ? 2 : 4), width, height: frame.height - nameHeight, text: deck.summary, size: m.sizes.summary, colorKey: "textMuted", align: "left", fit: true }));
    }
    this.add(new Button({ id: action.id, x: buttonX, y: (frame.height - m.button.height) / 2, width: m.button.width, height: m.button.height, text: action.text, textSize: "small", enabled: action.enabled !== false, onActivate: action.onActivate }));
  }
}

/** The deck's faction mix, as a short upright band (the deck builder's stripe). */
class Stripe extends UiNode {
  #bands;

  /** @param {{ x: number, y: number, width: number, height: number, bands: readonly { color: string, weight: number }[] }} options */
  constructor({ bands, ...frame }) {
    super(frame);
    this.#bands = bands;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const total = this.#bands.reduce((sum, band) => sum + band.weight, 0) || 1;
    let y = area.y;
    for (const band of this.#bands) {
      const height = (area.height * band.weight) / total;
      fillRoundedRect(context, { x: area.x, y, width: area.width, height }, { fill: band.color, radius: 2 });
      y += height;
    }
    if (this.#bands.length === 0) {
      fillRoundedRect(context, area, { fill: theme.colors.panelLight, radius: 2 });
    }
  }
}
