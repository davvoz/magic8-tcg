/**
 * The player's ranked entries as what they are: tickets. A stack of old
 * paper tickets, the top one printed "Admit one · Ranked" with what an entry
 * costs, a tear-off stub carrying a gold seal with how many the player holds,
 * and the jackpot's stamp across it; the more they hold, the more tickets
 * peek out behind it (up to three). With none, a single faded outline with
 * the seal at 0, in the danger colour.
 *
 * Each ticket is painted as ticketPaper.js paints it (aged by hand, seeded
 * so the same ticket always wears the same way). Decorative: pointer queries
 * look through it.
 */
import { STACK, TICKET, paintGhost, paintPaper, paintPrint, paintSeal, turnAbout, wear } from "../../ui/ticketPaper.js";
import { UiNode } from "../../ui/UiNode.js";

/** Above this, the seal says so rather than the number. */
const MAX_SHOWN = 999;

export class EntryTickets extends UiNode {
  /** How many entries the player holds; null when not known (one plain ticket, no seal). @type {number | null} */
  count;
  /** The ticket's name, printed large ("Ranked"). */
  title;
  /** What an entry costs, printed under the name ("1.000 STEEM"), or null. @type {string | null} */
  face;
  /** @type {import("../../ui/ticketPaper.js").Wear} */
  #wear;

  /**
   * @param {{ id?: string, x: number, y: number, width: number, height: number, count: number | null, title: string, face?: string | null, seed?: string }} options
   */
  constructor({ id, x, y, width, height, count, title, face = null, seed = "ticket" }) {
    super({ id, x, y, width, height });
    this.passthrough = true;
    this.count = count;
    this.title = title;
    this.face = face;
    this.#wear = wear(seed);
  }

  /** The width a stack of tickets `height` tall takes, the tickets behind included. @param {number} height */
  static widthFor(height) {
    const ticket = height / (1 + STACK.max * STACK.dy);
    return Math.ceil(ticket * TICKET.aspect * (1 + STACK.max * STACK.dx));
  }

  /** The height of a stack of tickets `width` wide, the tickets behind included: the inverse of `widthFor`. @param {number} width */
  static heightFor(width) {
    const ticket = width / (TICKET.aspect * (1 + STACK.max * STACK.dx));
    return Math.floor(ticket * (1 + STACK.max * STACK.dy));
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    // The ticket fits the area with the most tickets behind it, so the stack never moves as it grows.
    const height = Math.min(area.height / (1 + STACK.max * STACK.dy), area.width / (TICKET.aspect * (1 + STACK.max * STACK.dx)));
    const width = height * TICKET.aspect;
    const front = { x: area.x, y: area.y + area.height - height, width, height };
    if (this.count === 0) {
      paintGhost(context, theme, front, this.title);
      paintSeal(context, theme, front, { text: "0", tone: theme.colors.danger });
      return;
    }
    const behind = this.count === null ? 0 : Math.min(STACK.max, this.count - 1);
    for (let layer = behind; layer >= 1; layer -= 1) {
      const ticket = { ...front, x: front.x + layer * STACK.dx * width, y: front.y - layer * STACK.dy * height };
      context.save();
      turnAbout(context, ticket, this.#wear.turns[layer - 1]);
      paintPaper(context, theme, ticket, { marks: this.#wear, dusk: 0.35 + 0.15 * layer });
      context.restore();
    }
    paintPaper(context, theme, front, { marks: this.#wear, dusk: 0 });
    paintPrint(context, theme, front, { title: this.title, face: this.face });
    if (this.count !== null) {
      paintSeal(context, theme, front, { text: this.count > MAX_SHOWN ? `${MAX_SHOWN}+` : `×${this.count}`, tone: theme.colors.accent });
    }
  }
}
