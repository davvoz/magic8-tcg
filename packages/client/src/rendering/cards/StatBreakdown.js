/**
 * How a creature on the battlefield got to the stats it shows: what the card
 * says, the lasting boosts and penalties, those that last until end of turn,
 * the damage it has taken, and where that leaves it. The match's inspect
 * view lists it beside the card, so a 5/3 that was printed 4/4 explains
 * itself. A card whose stats are its printed ones has nothing to explain.
 */
import { Label } from "../ui/Label.js";
import { UiNode } from "../ui/UiNode.js";

/** @typedef {import("@magic8/engine/domain/game/GameSnapshot.js").CardView} CardView */

/**
 * @typedef {Readonly<{ label: string, value: string, colorKey: string, bold?: boolean }>} StatLine
 */

/** The modifier duration that ends with the turn (CardInstance's ModifierDuration). */
const END_OF_TURN = "end_of_turn";

/**
 * The lines that explain the card's stats, or none when they are the printed ones (or it is not a creature in play).
 * @param {Partial<CardView>} card
 * @returns {readonly StatLine[]}
 */
export function statLines(card) {
  const modifiers = card.modifiers ?? [];
  const damage = card.damage ?? 0;
  if (card.printedAttack === undefined || card.printedHealth === undefined || (modifiers.length === 0 && damage === 0)) {
    return [];
  }
  const lasting = sumOf(modifiers.filter((modifier) => modifier.duration !== END_OF_TURN));
  const thisTurn = sumOf(modifiers.filter((modifier) => modifier.duration === END_OF_TURN));
  return Object.freeze([
    { label: "Printed", value: `${card.printedAttack}/${card.printedHealth}`, colorKey: "textMuted" },
    ...changeLine("Boosts", lasting),
    ...changeLine("This turn", thisTurn),
    ...(damage > 0 ? [{ label: "Damage", value: `-${damage}`, colorKey: "danger" }] : []),
    { label: "Now", value: `${card.attack}/${card.health}`, colorKey: "accentLight", bold: true },
  ]);
}

/**
 * @param {readonly Readonly<{ attack: number, health: number }>[]} modifiers
 */
function sumOf(modifiers) {
  return modifiers.reduce((total, modifier) => ({ attack: total.attack + modifier.attack, health: total.health + modifier.health }), { attack: 0, health: 0 });
}

/**
 * @param {string} label
 * @param {{ attack: number, health: number }} change
 * @returns {StatLine[]}
 */
function changeLine(label, { attack, health }) {
  if (attack === 0 && health === 0) {
    return [];
  }
  return [{ label, value: `${signed(attack)}/${signed(health)}`, colorKey: attack + health >= 0 ? "success" : "danger" }];
}

/** @param {number} value */
function signed(value) {
  return value < 0 ? `${value}` : `+${value}`;
}

/** The lines as a small two-column table: what on the left, the stats on the right. */
export class StatBreakdown extends UiNode {
  /**
   * @param {{ id?: string, x: number, y: number, width: number, lines: readonly StatLine[], rowHeight: number, size?: import("../theme/Theme.js").FontSize }} options
   */
  constructor({ lines, rowHeight, size = "small", ...bounds }) {
    super({ ...bounds, height: lines.length * rowHeight });
    lines.forEach((line, index) => {
      const row = { y: index * rowHeight, height: rowHeight, size, weight: line.bold ? /** @type {const} */ ("bold") : /** @type {const} */ ("normal"), fit: true };
      this.add(new Label({ ...row, x: 0, width: bounds.width * 0.6, text: line.label, align: "left", colorKey: line.bold ? "text" : "textMuted" }));
      this.add(new Label({ ...row, x: bounds.width * 0.6, width: bounds.width * 0.4, text: line.value, align: "right", colorKey: line.colorKey }));
    });
  }
}
