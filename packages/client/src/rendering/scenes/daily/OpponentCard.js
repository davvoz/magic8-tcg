/**
 * One of the day's opponents on the challenges screen: who they are
 * (portrait, name, title, a band in their faction's colour), what they say
 * before the game, the rules a boss brings to the table, and where the
 * player stands against them (beaten, next, locked). The next one is lit.
 */
import { factionTones } from "../../theme/Theme.js";
import { fillRoundedRect } from "../../ui/drawing.js";
import { AvatarNode } from "../../ui/AvatarNode.js";
import { Label } from "../../ui/Label.js";
import { Panel } from "../../ui/Panel.js";
import { TextBlock } from "../../ui/TextBlock.js";

/** @typedef {import("../../../application/ports/DailyApi.contract.js").DailyOpponent} DailyOpponent */

/**
 * @typedef {Readonly<{
 *   inset: number, header: number, avatar: number, nameHeight: number, titleHeight: number, band: number,
 *   quote: number, ruleTitle: number, sizes: Readonly<{ name: import("../../theme/Theme.js").FontSize, text: import("../../theme/Theme.js").FontSize }>,
 * }>} OpponentCardMetrics `quote`: the room for the opening line (0: none)
 */

/** @type {OpponentCardMetrics} */
export const WIDE_CARD = Object.freeze({ inset: 22, header: 28, avatar: 72, nameHeight: 40, titleHeight: 26, band: 5, quote: 120, ruleTitle: 30, sizes: Object.freeze({ name: "heading", text: "small" }) });
/** @type {OpponentCardMetrics} */
export const COMPACT_CARD = Object.freeze({ inset: 10, header: 20, avatar: 40, nameHeight: 24, titleHeight: 18, band: 3, quote: 52, ruleTitle: 20, sizes: Object.freeze({ name: "body", text: "tiny" }) });

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
   * @param {{ id: string, x: number, y: number, width: number, height: number, opponent: DailyOpponent, stage: number, quote: string | null, metrics: OpponentCardMetrics, compact: boolean }} options
   *   `stage`: its place in the day (0, 1, then the boss); `quote`: its opening line to show (null: none)
   */
  constructor({ opponent, stage, quote, metrics, compact, ...frame }) {
    super({ ...frame, glowKey: opponent.state === "next" ? "accent" : null, smallCorners: compact });
    this.#faction = opponent.faction;
    const m = metrics;
    const inner = frame.width - 2 * m.inset;
    const state = STATES[opponent.state];
    const place = opponent.boss ? "Boss" : `Challenge ${stage + 1}`;
    this.add(new Label({ x: m.inset, y: m.inset / 2, width: inner / 2, height: m.header, text: place, size: m.sizes.text, weight: "bold", colorKey: opponent.boss ? "danger" : "accent", align: "left", fit: true }));
    this.add(new Label({ id: `${frame.id}.state`, x: m.inset + inner / 2, y: m.inset / 2, width: inner / 2, height: m.header, text: state.text, size: m.sizes.text, weight: "bold", colorKey: state.colorKey, align: "right", fit: true }));

    let y = m.inset / 2 + m.header + 6;
    this.add(new AvatarNode({ x: m.inset, y, size: m.avatar, account: opponent.account }));
    const textX = m.inset + m.avatar + 12;
    this.add(new Label({ id: `${frame.id}.name`, x: textX, y: y + (m.avatar - m.nameHeight - m.titleHeight) / 2, width: frame.width - textX - m.inset, height: m.nameHeight, text: opponent.name, size: m.sizes.name, weight: "bold", colorKey: opponent.state === "locked" ? "textMuted" : "accentLight", align: "left", fit: true }));
    this.add(new Label({ x: textX, y: y + (m.avatar + m.nameHeight - m.titleHeight) / 2, width: frame.width - textX - m.inset, height: m.titleHeight, text: opponent.title, size: m.sizes.text, colorKey: "textMuted", align: "left", fit: true }));
    y += m.avatar + 8;
    this.#bandY = y;
    this.#bandHeight = m.band;
    y += m.band + 10;

    if (m.quote > 0 && quote !== null) {
      this.add(new TextBlock({ id: `${frame.id}.quote`, x: m.inset, y, width: inner, height: m.quote, text: `“${quote}”`, size: m.sizes.text, colorKey: "accentLight" }));
      y += m.quote;
    }
    for (const [index, condition] of opponent.conditions.entries()) {
      const room = Math.max(0, frame.height - y - m.inset / 2);
      if (room < m.ruleTitle) {
        break;
      }
      this.add(new Label({ id: `${frame.id}.rule.${index}`, x: m.inset, y, width: inner, height: m.ruleTitle, text: `${condition.name} (for ${SCOPES[/** @type {keyof typeof SCOPES} */ (condition.scope)] ?? condition.scope})`, size: m.sizes.text, weight: "bold", colorKey: "danger", align: "left", fit: true }));
      y += m.ruleTitle;
      const textHeight = Math.min(room - m.ruleTitle, m.ruleTitle * 2.4);
      this.add(new TextBlock({ x: m.inset, y, width: inner, height: textHeight, text: condition.text, size: m.sizes.text, colorKey: "text" }));
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
