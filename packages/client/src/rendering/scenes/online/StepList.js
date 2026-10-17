/**
 * Steps one under the other, each on a row of the same height: a disc on
 * the left and the step's words beside it. The disc says where the player
 * stands with the step: its number (to do, in the way to play's tone), a
 * check (done, green), a padlock (not open yet) or an exclamation mark
 * (missing, red). A row may leave room on its right for a button the screen
 * puts there (`trail`). Its words are TextBlocks, so they wrap and tests
 * read them (`<id>.text.<n>`).
 */
import { withAlpha } from "../../theme/color.js";
import { bodyFont } from "../../theme/Theme.js";
import { drawCheckIcon } from "../../ui/shapes.js";
import { TextBlock } from "../../ui/TextBlock.js";
import { UiNode } from "../../ui/UiNode.js";
import { drawPadlock, playTone } from "./lobbyIcons.js";

/** Where the player stands with a step. */
export const StepState = Object.freeze({ TODO: "todo", DONE: "done", LOCKED: "locked", MISSING: "missing" });
/** The disc: its radius in row heights (at most `maxRadius`), and the space after it. */
const DISC = Object.freeze({ share: 0.32, maxRadius: 15, gap: 12 });

/**
 * @typedef {Readonly<{ text: string, state?: string, colorKey?: string, trail?: number }>} Step
 *   `state`: one of StepState (to do, by default); `trail`: the width kept free on the row's right
 */

export class StepList extends UiNode {
  /** One of PlayKind: the tone of the steps to do. */
  kind;
  /** @type {readonly Step[]} */
  steps;
  #rowHeight;

  /**
   * @param {{ id: string, x: number, y: number, width: number, height: number, kind: string, steps: readonly Step[] }} options
   *   the rows share the height evenly
   */
  constructor({ kind, steps, ...frame }) {
    super(frame);
    this.passthrough = true;
    this.kind = kind;
    this.steps = steps;
    this.#rowHeight = steps.length === 0 ? 0 : frame.height / steps.length;
    const textX = this.#textX;
    steps.forEach((step, index) => {
      const colorKey = step.colorKey ?? (step.state === StepState.MISSING ? "danger" : "text");
      this.add(new TextBlock({ id: `${frame.id}.text.${index + 1}`, x: textX, y: index * this.#rowHeight, width: Math.max(0, frame.width - textX - (step.trail ?? 0)), height: this.#rowHeight, text: step.text, size: "small", colorKey, valign: "middle" }));
    });
  }

  /** The top of a row, in the list's own frame. @param {number} index */
  rowY(index) {
    return index * this.#rowHeight;
  }

  get rowHeight() {
    return this.#rowHeight;
  }

  get #radius() {
    return Math.min(DISC.maxRadius, this.#rowHeight * DISC.share);
  }

  get #textX() {
    return 2 * this.#radius + DISC.gap;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    this.steps.forEach((step, index) => {
      const center = { x: area.x + this.#radius, y: area.y + this.rowY(index) + this.#rowHeight / 2 };
      paintDisc(context, theme, { center, radius: this.#radius }, { kind: this.kind, state: step.state ?? StepState.TODO, number: index + 1 });
    });
  }
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {import("../../theme/Theme.js").Theme} theme
 * @param {{ center: { x: number, y: number }, radius: number }} disc
 * @param {{ kind: string, state: string, number: number }} step
 */
function paintDisc(context, theme, { center, radius }, { kind, state, number }) {
  const { colors } = theme;
  const tone = playTone(theme, kind);
  const ring = { [StepState.DONE]: colors.success, [StepState.MISSING]: colors.danger, [StepState.LOCKED]: colors.textMuted }[state] ?? tone.base;
  context.save();
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.fillStyle = state === StepState.TODO ? withAlpha(tone.base, 0.9) : withAlpha(ring, 0.18);
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = ring;
  context.stroke();
  if (state === StepState.DONE) {
    drawCheckIcon(context, center, radius * 1.1, { color: colors.success });
  } else if (state === StepState.LOCKED) {
    drawPadlock(context, center, radius * 1.1, { fill: withAlpha(colors.textMuted, 0.5), rim: colors.text });
  } else {
    context.font = bodyFont(theme, radius * 1.15, "bold");
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = state === StepState.MISSING ? colors.danger : colors.accentText;
    context.fillText(state === StepState.MISSING ? "!" : String(number), center.x, center.y + 1);
  }
  context.restore();
}
