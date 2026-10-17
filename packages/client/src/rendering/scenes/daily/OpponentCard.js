/**
 * One of the day's opponents on the challenges screen: who they are (their
 * living portrait with their name and title on it, a band in their faction's
 * colour), what they say before the game, the rules a boss brings to the
 * table, and where the player stands against them (beaten, next, locked).
 * The next one is lit. A boss's rules come before its words when the card is
 * short of room.
 */
import { CharacterPortrait } from "./CharacterPortrait.js";
import { factionTones } from "../../theme/Theme.js";
import { fillRoundedRect } from "../../ui/drawing.js";
import { Label } from "../../ui/Label.js";
import { PANEL_INSET, Panel, SMALL_PANEL_INSET } from "../../ui/Panel.js";
import { TextBlock } from "../../ui/TextBlock.js";

/** @typedef {import("../../../application/ports/DailyApi.contract.js").DailyOpponent} DailyOpponent */

/**
 * @typedef {Readonly<{
 *   inset: number, header: number, headerInset: number, portrait: number, layout: import("./CharacterPortrait.js").PortraitLayout, nameHeight: number, titleHeight: number, band: number,
 *   quote: number, minQuote: number, ruleTitle: number, ruleText: number, sizes: Readonly<{ name: import("../../theme/Theme.js").FontSize, text: import("../../theme/Theme.js").FontSize }>,
 * }>} OpponentCardMetrics `headerInset`: how far the top line keeps from the sides, clear of the painted corners; `portrait`: its height; `quote`: the most room for the opening line, `minQuote` the least worth showing; `ruleText`: the most room for a rule's words
 */

/** @type {OpponentCardMetrics} */
export const WIDE_CARD = Object.freeze({ inset: 22, header: 28, headerInset: PANEL_INSET + 8, portrait: 300, layout: "stacked", nameHeight: 40, titleHeight: 26, band: 5, quote: 100, minQuote: 26, ruleTitle: 30, ruleText: 52, sizes: Object.freeze({ name: "heading", text: "small" }) });
/** @type {OpponentCardMetrics} */
export const COMPACT_CARD = Object.freeze({ inset: 10, header: 20, headerInset: SMALL_PANEL_INSET + 12, portrait: 104, layout: "stacked", nameHeight: 22, titleHeight: 16, band: 3, quote: 52, minQuote: 16, ruleTitle: 20, ruleText: 40, sizes: Object.freeze({ name: "body", text: "tiny" }) });

/** What the badge says, and in which colour, for each state. */
const STATES = Object.freeze({
  beaten: Object.freeze({ text: "Beaten", colorKey: "success" }),
  next: Object.freeze({ text: "Next", colorKey: "accentLight" }),
  locked: Object.freeze({ text: "Locked", colorKey: "textMuted" }),
});

/** Who a condition holds for, as the challenger reads it. */
const SCOPES = Object.freeze({ everyone: "everyone", opponent: "the boss", challenger: "you" });

export class OpponentCard extends Panel {
  #faction;
  /** Where the faction band runs, inside the card. */
  #bandY;
  #bandHeight;

  /**
   * @param {{ id: string, x: number, y: number, width: number, height: number, opponent: DailyOpponent, stage: number, quote: string | null, metrics: OpponentCardMetrics, compact: boolean, clock: () => number }} options
   *   `stage`: its place in the day (0, 1, then the boss); `quote`: its opening line to show (null: none); `clock`: the scene's animation time
   */
  constructor({ opponent, stage, quote, metrics, compact, clock, ...frame }) {
    super({ ...frame, glowKey: opponent.state === "next" ? "accent" : null, smallCorners: compact });
    this.#faction = opponent.faction;
    const m = metrics;
    const inner = frame.width - 2 * m.inset;
    const state = STATES[opponent.state];
    const place = opponent.boss ? "Boss" : `Challenge ${stage + 1}`;
    const headerWidth = (frame.width - 2 * m.headerInset) / 2;
    this.add(new Label({ x: m.headerInset, y: m.inset / 2, width: headerWidth, height: m.header, text: place, size: m.sizes.text, weight: "bold", colorKey: opponent.boss ? "danger" : "accent", align: "left", fit: true }));
    this.add(new Label({ id: `${frame.id}.state`, x: m.headerInset + headerWidth, y: m.inset / 2, width: headerWidth, height: m.header, text: state.text, size: m.sizes.text, weight: "bold", colorKey: state.colorKey, align: "right", fit: true }));

    let y = m.inset / 2 + m.header + 4;
    const portrait = this.add(new CharacterPortrait({ id: `${frame.id}.portrait`, x: m.inset, y, width: inner, height: m.portrait, character: opponent, layout: m.layout, clock }));
    const text = portrait.textArea;
    const textX = m.inset + text.x + 10;
    const textWidth = text.width - 20;
    const nameY = y + text.y + (text.height - m.nameHeight - m.titleHeight) / 2;
    this.add(new Label({ id: `${frame.id}.name`, x: textX, y: nameY, width: textWidth, height: m.nameHeight, text: opponent.name, size: m.sizes.name, weight: "bold", colorKey: opponent.state === "locked" ? "textMuted" : "accentLight", align: "left", fit: true }));
    this.add(new Label({ x: textX, y: nameY + m.nameHeight, width: textWidth, height: m.titleHeight, text: opponent.title, size: m.sizes.text, colorKey: "text", align: "left", fit: true }));
    y += m.portrait + 6;
    this.#bandY = y;
    this.#bandHeight = m.band;
    y += m.band + 8;

    const rules = opponent.conditions.length * (m.ruleTitle + m.ruleText);
    // The quote and the rules run down to the card's foot: clear of its painted corners.
    const side = Math.max(m.inset, this.titleInset);
    const quoteRoom = Math.min(m.quote, frame.height - m.inset / 2 - y - rules);
    if (quote !== null && quoteRoom >= m.minQuote) {
      this.add(new TextBlock({ id: `${frame.id}.quote`, x: side, y, width: frame.width - 2 * side, height: quoteRoom, text: `“${quote}”`, size: m.sizes.text, colorKey: "accentLight" }));
      y += quoteRoom;
    }
    for (const [index, condition] of opponent.conditions.entries()) {
      const room = Math.max(0, frame.height - y - m.inset / 2);
      if (room < m.ruleTitle) {
        break;
      }
      this.add(new Label({ id: `${frame.id}.rule.${index}`, x: side, y, width: frame.width - 2 * side, height: m.ruleTitle, text: `${condition.name} (for ${SCOPES[/** @type {keyof typeof SCOPES} */ (condition.scope)] ?? condition.scope})`, size: m.sizes.text, weight: "bold", colorKey: "danger", align: "left", fit: true }));
      y += m.ruleTitle;
      const textHeight = Math.min(room - m.ruleTitle, m.ruleText);
      this.add(new TextBlock({ x: side, y, width: frame.width - 2 * side, height: textHeight, text: condition.text, size: m.sizes.text, colorKey: "text" }));
      y += textHeight;
    }
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    super.paint(context, theme);
    const { x, width } = this.bounds;
    const tones = factionTones(theme, this.#faction);
    fillRoundedRect(context, { x: x + 12, y: this.bounds.y + this.#bandY, width: width - 24, height: this.#bandHeight }, { fill: tones.base, radius: this.#bandHeight / 2 });
  }
}
