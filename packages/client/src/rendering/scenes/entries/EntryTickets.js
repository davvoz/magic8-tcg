/**
 * The player's ranked entries as what they are: tickets. A stack of old
 * paper tickets, the top one printed "Admit one · Ranked" with what an entry
 * costs, a tear-off stub carrying a gold seal with how many the player holds,
 * and the jackpot's stamp across it; the more they hold, the more tickets
 * peek out behind it (up to three). With none, a single faded outline with
 * the seal at 0, in the danger colour.
 *
 * The paper is aged by hand: toned edges, a coffee ring, foxing spots and a
 * crease, seeded so the same ticket always wears the same way. Every colour
 * comes from the theme's gold and ink. Decorative: pointer queries look
 * through it.
 */
import { withAlpha, mix } from "../../theme/color.js";
import { bodyFont, displayFont } from "../../theme/Theme.js";
import { randomStream } from "../../ui/backdropLight.js";
import { UiNode } from "../../ui/UiNode.js";

/** A ticket's width in heights, and where its stub is torn off (a fraction of its width). */
const TICKET = Object.freeze({ aspect: 1.9, stub: 0.72, notch: 0.12, frame: 0.07 });
/** The tickets behind the top one: at most this many, each this far up and to the right (fractions of a ticket), turned by up to `turn` radians. */
const STACK = Object.freeze({ max: 3, dx: 0.05, dy: 0.07, turn: 0.07 });
/** The seal on the stub, in ticket heights. */
const SEAL = Object.freeze({ radius: 0.24 });
/** How many marks of age a ticket carries. */
const AGE = Object.freeze({ foxing: 14, rings: 1, blotches: 2 });
/** Above this, the seal says so rather than the number. */
const MAX_SHOWN = 999;

/**
 * @typedef {Readonly<{ x: number, y: number, radius: number, alpha: number }>} Mark a spot of age, in fractions of the ticket
 * @typedef {Readonly<{ foxing: readonly Mark[], rings: readonly Mark[], blotches: readonly Mark[], crease: Readonly<{ x: number, lean: number }>, turns: readonly number[] }>} Wear
 */

export class EntryTickets extends UiNode {
  /** How many entries the player holds; null when not known (one plain ticket, no seal). @type {number | null} */
  count;
  /** The ticket's name, printed large ("Ranked"). */
  title;
  /** What an entry costs, printed under the name ("1.000 STEEM"), or null. @type {string | null} */
  face;
  /** @type {Wear} */
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

/**
 * The marks of age a seed gives, the same every time.
 * @param {string} seed
 * @returns {Wear}
 */
function wear(seed) {
  const random = randomStream(`entry-ticket:${seed}`);
  /** @param {number} count @param {{ min: number, max: number }} radius @param {{ min: number, max: number }} alpha */
  const marks = (count, radius, alpha) =>
    Object.freeze(
      Array.from({ length: count }, () =>
        Object.freeze({ x: 0.08 + random() * 0.84, y: 0.12 + random() * 0.76, radius: radius.min + random() * (radius.max - radius.min), alpha: alpha.min + random() * (alpha.max - alpha.min) }),
      ),
    );
  return Object.freeze({
    foxing: marks(AGE.foxing, { min: 0.008, max: 0.03 }, { min: 0.12, max: 0.32 }),
    rings: marks(AGE.rings, { min: 0.16, max: 0.24 }, { min: 0.1, max: 0.18 }),
    blotches: marks(AGE.blotches, { min: 0.12, max: 0.22 }, { min: 0.08, max: 0.16 }),
    crease: Object.freeze({ x: 0.3 + random() * 0.3, lean: (random() - 0.5) * 0.12 }),
    turns: Object.freeze(Array.from({ length: STACK.max }, (_, index) => (index % 2 === 0 ? 1 : -1) * STACK.turn * (0.4 + random() * 0.6))),
  });
}

/**
 * Turns what follows about the ticket's centre.
 * @param {CanvasRenderingContext2D} context
 * @param {import("@magic8/engine/shared/geometry.js").Rect} ticket
 * @param {number} angle
 */
function turnAbout(context, ticket, angle) {
  const center = { x: ticket.x + ticket.width / 2, y: ticket.y + ticket.height / 2 };
  context.translate(center.x, center.y);
  context.rotate(angle);
  context.translate(-center.x, -center.y);
}

/**
 * A ticket's outline: notched at its four corners and on both edges where the stub tears off.
 * @param {CanvasRenderingContext2D} context
 * @param {import("@magic8/engine/shared/geometry.js").Rect} ticket
 */
function ticketPath(context, { x, y, width, height }) {
  const corner = height * TICKET.notch;
  const notch = height * TICKET.notch;
  const tear = x + width * TICKET.stub;
  const right = x + width;
  const bottom = y + height;
  context.beginPath();
  context.moveTo(x + corner, y);
  context.lineTo(tear - notch, y);
  context.arc(tear, y, notch, Math.PI, 0, true);
  context.lineTo(right - corner, y);
  context.arc(right, y, corner, Math.PI, Math.PI / 2, true);
  context.lineTo(right, bottom - corner);
  context.arc(right, bottom, corner, -Math.PI / 2, Math.PI, true);
  context.lineTo(tear + notch, bottom);
  context.arc(tear, bottom, notch, 0, Math.PI, true);
  context.lineTo(x + corner, bottom);
  context.arc(x, bottom, corner, 0, -Math.PI / 2, true);
  context.lineTo(x, y + corner);
  context.arc(x, y, corner, Math.PI / 2, 0, true);
  context.closePath();
}

/**
 * Old paper: toned toward its edges, stained, spotted and creased; `dusk` (0–1) darkens it (the tickets further back).
 * @param {CanvasRenderingContext2D} context
 * @param {import("../../theme/Theme.js").Theme} theme
 * @param {import("@magic8/engine/shared/geometry.js").Rect} ticket
 * @param {{ marks: Wear, dusk: number }} age
 */
function paintPaper(context, theme, ticket, { marks, dusk }) {
  const { accentLight, accent, accentDark, letterbox } = theme.colors;
  const { x, y, width, height } = ticket;
  context.save();
  ticketPath(context, ticket);
  context.shadowColor = withAlpha(letterbox, 0.6);
  context.shadowBlur = height * 0.18;
  const paper = context.createLinearGradient(x, y, x + width * 0.3, y + height);
  paper.addColorStop(0, mix(accentLight, accent, 0.12 + dusk * 0.4));
  paper.addColorStop(0.6, mix(accentLight, accent, 0.32 + dusk * 0.4));
  paper.addColorStop(1, mix(accent, accentDark, 0.2 + dusk * 0.5));
  context.fillStyle = paper;
  context.fill();
  context.shadowBlur = 0;
  context.clip();
  // Toned edges: the paper browns from the rim inward.
  context.save();
  context.translate(x + width / 2, y + height / 2);
  context.scale(1, height / width);
  const tone = context.createRadialGradient(0, 0, width * 0.25, 0, 0, width * 0.62);
  tone.addColorStop(0, withAlpha(accentDark, 0));
  tone.addColorStop(1, withAlpha(accentDark, 0.55));
  context.fillStyle = tone;
  context.fillRect(-width / 2, -width / 2, width, width);
  context.restore();
  for (const blotch of marks.blotches) {
    const at = { x: x + blotch.x * width, y: y + blotch.y * height };
    const stain = context.createRadialGradient(at.x, at.y, 0, at.x, at.y, blotch.radius * width);
    stain.addColorStop(0, withAlpha(accentDark, blotch.alpha));
    stain.addColorStop(1, withAlpha(accentDark, 0));
    context.fillStyle = stain;
    context.fillRect(at.x - blotch.radius * width, at.y - blotch.radius * width, 2 * blotch.radius * width, 2 * blotch.radius * width);
  }
  for (const ring of marks.rings) {
    context.beginPath();
    context.arc(x + ring.x * width, y + ring.y * height, ring.radius * height * 1.6, 0.4, Math.PI * 1.7);
    context.lineWidth = Math.max(1, height * 0.035);
    context.strokeStyle = withAlpha(accentDark, ring.alpha);
    context.stroke();
  }
  for (const spot of marks.foxing) {
    context.beginPath();
    context.arc(x + spot.x * width, y + spot.y * height, Math.max(0.6, spot.radius * height), 0, Math.PI * 2);
    context.fillStyle = withAlpha(accentDark, spot.alpha);
    context.fill();
  }
  // The crease: a fold across the ticket, lit on one side and shadowed on the other.
  const fold = { top: x + marks.crease.x * width, bottom: x + (marks.crease.x + marks.crease.lean) * width };
  context.lineWidth = Math.max(0.75, height * 0.012);
  context.strokeStyle = withAlpha(accentDark, 0.32);
  context.beginPath();
  context.moveTo(fold.top, y);
  context.lineTo(fold.bottom, y + height);
  context.stroke();
  context.strokeStyle = withAlpha(accentLight, 0.45);
  context.beginPath();
  context.moveTo(fold.top + context.lineWidth * 1.5, y);
  context.lineTo(fold.bottom + context.lineWidth * 1.5, y + height);
  context.stroke();
  context.restore();
  context.save();
  ticketPath(context, ticket);
  context.lineWidth = Math.max(1, height * 0.015);
  context.strokeStyle = withAlpha(accentDark, 0.8);
  context.stroke();
  context.restore();
}

/**
 * The printing on the top ticket: a double frame, "Admit one", its name, what it costs, the perforation and the jackpot's stamp.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../../theme/Theme.js").Theme} theme
 * @param {import("@magic8/engine/shared/geometry.js").Rect} ticket
 * @param {{ title: string, face: string | null }} print
 */
function paintPrint(context, theme, ticket, { title, face }) {
  const { accentDark, accentText, danger } = theme.colors;
  const { x, y, width, height } = ticket;
  const inset = height * TICKET.frame;
  const tear = x + width * TICKET.stub;
  const body = { x: x + inset, y: y + inset, width: tear - x - 2 * inset, height: height - 2 * inset };
  const ink = withAlpha(accentText, 0.86);
  context.save();
  context.strokeStyle = withAlpha(accentDark, 0.85);
  context.lineWidth = Math.max(1, height * 0.018);
  strokeBox(context, body);
  context.lineWidth = Math.max(0.5, height * 0.008);
  const fine = height * 0.035;
  strokeBox(context, { x: body.x + fine, y: body.y + fine, width: body.width - 2 * fine, height: body.height - 2 * fine });
  // The perforation where the stub tears off.
  context.setLineDash([height * 0.04, height * 0.04]);
  context.lineWidth = Math.max(1, height * 0.02);
  context.beginPath();
  context.moveTo(tear, y + height * TICKET.notch);
  context.lineTo(tear, y + height * (1 - TICKET.notch));
  context.stroke();
  context.setLineDash([]);
  const center = body.x + body.width / 2;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = ink;
  context.font = bodyFont(theme, height * 0.12, "bold");
  context.fillText(spaced("ADMIT ONE"), center, body.y + body.height * 0.2);
  context.font = displayFont(theme, fittedSize(context, theme, title.toUpperCase(), { size: height * 0.32, width: body.width * 0.86 }));
  context.fillText(title.toUpperCase(), center, body.y + body.height * 0.52);
  if (face !== null) {
    context.font = bodyFont(theme, Math.min(height * 0.12, fittedSize(context, theme, face, { size: height * 0.12, width: body.width * 0.8, body: true })), "bold");
    context.fillText(face, center, body.y + body.height * 0.82);
  }
  // The jackpot's stamp, pressed on at a slant and half worn away.
  // In the corner, clear of the price, half over the frame.
  const stamp = { x: body.x + body.width * 0.9, y: body.y + body.height * 0.9 };
  context.translate(stamp.x, stamp.y);
  context.rotate(-0.38);
  const label = "JACKPOT";
  context.font = displayFont(theme, height * 0.085);
  const stampWidth = context.measureText(label).width + height * 0.1;
  context.strokeStyle = withAlpha(danger, 0.5);
  context.lineWidth = Math.max(1, height * 0.018);
  strokeBox(context, { x: -stampWidth / 2, y: -height * 0.07, width: stampWidth, height: height * 0.14 });
  context.fillStyle = withAlpha(danger, 0.55);
  context.fillText(label, 0, 0);
  context.restore();
}

/**
 * A ticket the player does not have: its outline, dashed and faded.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../../theme/Theme.js").Theme} theme
 * @param {import("@magic8/engine/shared/geometry.js").Rect} ticket
 * @param {string} title
 */
function paintGhost(context, theme, ticket, title) {
  const { panelDark, danger, textMuted } = theme.colors;
  const { x, y, width, height } = ticket;
  context.save();
  ticketPath(context, ticket);
  context.fillStyle = withAlpha(panelDark, 0.7);
  context.fill();
  context.setLineDash([height * 0.07, height * 0.05]);
  context.lineWidth = Math.max(1, height * 0.025);
  context.strokeStyle = withAlpha(danger, 0.75);
  context.stroke();
  context.setLineDash([]);
  const center = x + (width * TICKET.stub) / 2;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = withAlpha(textMuted, 0.8);
  context.font = bodyFont(theme, height * 0.12, "bold");
  context.fillText(spaced("ADMIT ONE"), center, y + height * 0.27);
  context.font = displayFont(theme, fittedSize(context, theme, title.toUpperCase(), { size: height * 0.3, width: width * TICKET.stub * 0.8 }));
  context.fillText(title.toUpperCase(), center, y + height * 0.58);
  context.restore();
}

/**
 * The gold seal on the stub, with how many tickets the player holds.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../../theme/Theme.js").Theme} theme
 * @param {import("@magic8/engine/shared/geometry.js").Rect} ticket
 * @param {{ text: string, tone: string }} seal
 */
function paintSeal(context, theme, ticket, { text, tone }) {
  const { accentLight, accentText, letterbox } = theme.colors;
  const radius = ticket.height * SEAL.radius;
  const center = { x: ticket.x + ticket.width * (1 + TICKET.stub) / 2, y: ticket.y + ticket.height / 2 };
  context.save();
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  const metal = context.createRadialGradient(center.x - radius * 0.35, center.y - radius * 0.4, radius * 0.1, center.x, center.y, radius);
  metal.addColorStop(0, mix(tone, accentLight, 0.7));
  metal.addColorStop(0.55, tone);
  metal.addColorStop(1, mix(tone, letterbox, 0.45));
  context.shadowColor = withAlpha(letterbox, 0.55);
  context.shadowBlur = radius * 0.5;
  context.fillStyle = metal;
  context.fill();
  context.shadowBlur = 0;
  context.lineWidth = Math.max(1, radius * 0.1);
  context.strokeStyle = mix(tone, letterbox, 0.55);
  context.stroke();
  context.beginPath();
  context.arc(center.x, center.y, radius * 0.8, 0, Math.PI * 2);
  context.lineWidth = Math.max(0.5, radius * 0.05);
  context.strokeStyle = withAlpha(accentLight, 0.6);
  context.stroke();
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = displayFont(theme, fittedSize(context, theme, text, { size: radius * 0.95, width: radius * 1.5 }));
  context.fillStyle = accentText;
  context.fillText(text, center.x, center.y + radius * 0.05);
  context.restore();
}

/**
 * @param {CanvasRenderingContext2D} context
 * @param {import("@magic8/engine/shared/geometry.js").Rect} box
 */
function strokeBox(context, { x, y, width, height }) {
  context.beginPath();
  context.rect(x, y, width, height);
  context.stroke();
}

/**
 * The largest size up to `size` at which the text fits the width.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../../theme/Theme.js").Theme} theme
 * @param {string} text
 * @param {{ size: number, width: number, body?: boolean }} fit `body`: set in the body face (else the display face)
 */
function fittedSize(context, theme, text, { size, width, body = false }) {
  context.font = body ? bodyFont(theme, size, "bold") : displayFont(theme, size);
  const measured = context.measureText(text).width;
  return measured <= width || measured === 0 ? size : (size * width) / measured;
}

/** "A D M I T   O N E": letters set apart, as old print does. @param {string} text */
const spaced = (text) => [...text].join(" ").replaceAll("   ", "  ");
