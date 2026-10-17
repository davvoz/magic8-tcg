/**
 * How ranked play works, as three stations joined by arrows: the player's
 * ranked entries (drawn as the stack of tickets they hold, the seal saying
 * how many), a game (crossed swords) and the season's jackpot (a trophy over
 * heaps of coins, its amount on a plaque when known). Under each, its name
 * and a few words. On a gold-tinted band, with a header on a wide screen.
 *
 * The words come from the scene; this only lays them out and draws the
 * pictures. Decorative: pointer queries look through it.
 */
import { withAlpha } from "../../theme/color.js";
import { bodyFont, fontFor } from "../../theme/Theme.js";
import { drawArrow } from "../../ui/shapes.js";
import { fillRoundedRect } from "../../ui/drawing.js";
import { Label } from "../../ui/Label.js";
import { TextBlock } from "../../ui/TextBlock.js";
import { UiNode } from "../../ui/UiNode.js";
import { EntryTickets } from "../entries/EntryTickets.js";
import { PlayKind, drawCoinHeap, drawCrossedSwords, drawMedallion, drawTrophy, iconMetals, playTone } from "./lobbyIcons.js";

/**
 * Sizes of the guide, wide (in the ranked panel) and compact (in a phone's dialog): the space around it, its header,
 * the pictures' height, the gap between stations (where the arrows go), the name under each picture, the space under the words.
 */
const WIDE = Object.freeze({ pad: 10, header: 22, visual: 72, gap: 30, title: 24, number: 11, bottom: 4 });
const COMPACT = Object.freeze({ pad: 6, header: 0, visual: 62, gap: 16, title: 22, number: 9, bottom: 4 });
/** On a phone: the row of the steps' numbers over the pictures; the words under the title (two lines); the least picture. */
const NUMBER_ROW = 2 * COMPACT.number + 4;
const COMPACT_WORDS = 40;
const COMPACT_LEAST_VISUAL = 40;
/**
 * The plates layout (a wide screen's ranked panel, where the room is short): each step on a gilt-rimmed plate of its
 * own, its number on a disc at the plate's corner, a bold gold arrow in the gap to the next; `inset`: the plate's padding.
 */
const PLATES = Object.freeze({ pad: 0, header: 0, visual: 54, gap: 34, title: 22, number: 12, bottom: 4, inset: 7 });
/** The jackpot's plaque: its height. */
const PLAQUE = Object.freeze({ height: 22 });
/** The heaps of coins beside the trophy: how far out from the medallion, how far down (in its radii), how wide (in its radii). */
const COINS = Object.freeze({ offset: 26, drop: 0.7, width: 2 });

/** @typedef {Readonly<{ title: string, text: string }>} GuideStep */

export class RankedGuide extends UiNode {
  #m;
  /** The amount on the jackpot's plaque, or null. @type {string | null} */
  #jackpot;
  #station;
  /** Whether each step stands on a plate of its own (else the guide is one band). */
  #plates;
  /** Whether the steps' numbers have a row of their own over the pictures (a phone's: clear of them) rather than lying on them. */
  #numberRow;

  /**
   * @param {{ id?: string, x: number, y: number, width: number, height: number, steps: readonly [GuideStep, GuideStep, GuideStep], tickets: { count: number | null, face: string | null }, jackpot?: string | null, compact?: boolean, plates?: boolean }} options
   *   `tickets`: how many entries the player holds (null: not known) and what one costs; `jackpot`: the season's jackpot ("866 STEEM");
   *   `plates`: each step on a plate of its own (a wide screen's ranked panel)
   */
  constructor({ id = "online.guide", x, y, width, height, steps, tickets, jackpot = null, compact = false, plates = false }) {
    super({ id, x, y, width, height });
    this.passthrough = true;
    this.#plates = plates;
    this.#numberRow = compact && !plates;
    this.#m = this.#numberRow ? fittedCompact(height) : metricsFor({ compact, plates });
    this.#jackpot = jackpot;
    const m = this.#m;
    this.#station = (width - 2 * m.pad - 2 * m.gap) / 3;
    const visualTop = m.pad + m.header + (plates ? PLATES.inset : 0) + (this.#numberRow ? NUMBER_ROW : 0);
    // The tickets the player holds stand for the first station.
    const ticketsHeight = Math.min(m.visual, EntryTickets.heightFor(this.#station));
    const ticketsWidth = EntryTickets.widthFor(ticketsHeight);
    this.add(new EntryTickets({ id: `${this.id}.tickets`, x: this.#stationX(0) + (this.#station - ticketsWidth) / 2, y: visualTop + (m.visual - ticketsHeight) / 2, width: ticketsWidth, height: ticketsHeight, count: tickets.count, title: "Ranked", face: tickets.face, seed: "lobby" }));
    if (jackpot !== null) {
      this.add(new Label({ id: `${this.id}.jackpot`, x: this.#stationX(2), y: visualTop + m.visual - PLAQUE.height, width: this.#station, height: PLAQUE.height, text: jackpot, size: "small", weight: "bold", colorKey: "accentText", fit: true }));
    }
    const titleY = visualTop + m.visual + 8;
    const textY = titleY + m.title + 2;
    steps.forEach((step, index) => {
      const at = this.#stationX(index);
      const side = plates ? PLATES.inset : 0;
      this.add(new Label({ id: `${this.id}.title.${index + 1}`, x: at + side, y: titleY, width: this.#station - 2 * side, height: m.title, text: step.title, size: compact && !plates ? "small" : "body", weight: "bold", colorKey: "accentLight", fit: true }));
      this.add(new TextBlock({ id: `${this.id}.text.${index + 1}`, x: at + side, y: textY, width: this.#station - 2 * side, height: Math.max(0, height - textY - m.bottom), text: step.text, size: "small", align: "center", colorKey: plates ? "text" : "textMuted" }));
    });
  }

  /** @param {number} index */
  #stationX(index) {
    return this.#m.pad + index * (this.#station + this.#m.gap);
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const { colors } = theme;
    const m = this.#m;
    const tone = playTone(theme, PlayKind.RANKED);
    const left = (/** @type {number} */ index) => area.x + this.#stationX(index);
    const visualTop = area.y + m.pad + m.header + (this.#plates ? PLATES.inset : 0) + (this.#numberRow ? NUMBER_ROW : 0);
    const middle = visualTop + m.visual / 2;
    if (this.#plates) {
      this.#paintPlates(context, theme, area);
    } else {
      this.#paintBand(context, theme, { area, middle });
    }
    // A game: crossed swords on a medallion.
    const radius = m.visual * 0.42;
    const swords = { x: left(1) + this.#station / 2, y: middle };
    drawMedallion(context, swords, radius, { tone, shadow: colors.letterbox });
    const metals = iconMetals(theme);
    drawCrossedSwords(context, swords, radius * 1.15, metals);
    // The jackpot: a trophy on a medallion, coins heaped on either side, the amount on a plaque.
    const prizeRadius = this.#jackpot === null ? radius : m.visual * 0.36;
    const prize = { x: left(2) + this.#station / 2, y: this.#jackpot === null ? middle : visualTop + prizeRadius + 2 };
    for (const side of [-1, 1]) {
      // Beside the trophy, but never past the station (a narrow guide's).
      const reach = Math.min(prizeRadius + COINS.offset, this.#station / 2 - (prizeRadius * COINS.width) / 2);
      drawCoinHeap(context, { x: prize.x + side * Math.max(0, reach), y: prize.y + prizeRadius * COINS.drop }, prizeRadius * COINS.width, { fill: colors.accent, rim: colors.accentDark, shine: colors.accentLight });
    }
    drawMedallion(context, prize, prizeRadius, { tone, shadow: colors.letterbox });
    drawTrophy(context, { x: prize.x, y: prize.y + prizeRadius * 0.04 }, prizeRadius * 1.25, metals);
    if (this.#jackpot !== null) {
      this.#paintPlaque(context, theme, { x: left(2), y: visualTop + m.visual - PLAQUE.height });
    }
    const numberInset = this.#plates ? PLATES.inset * 0.6 : 0;
    for (let index = 0; index < 3; index += 1) {
      this.#paintNumber(context, theme, { x: left(index) + m.number + numberInset, y: area.y + m.pad + m.header + m.number + numberInset }, index + 1);
    }
  }

  /**
   * One band under the three steps, its header across the top (a wide screen), thin arrows between the steps.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   * @param {{ area: import("@magic8/engine/shared/geometry.js").Rect, middle: number }} where
   */
  #paintBand(context, theme, { area, middle }) {
    const { colors } = theme;
    fillRoundedRect(context, area, { fill: withAlpha(colors.accentDark, 0.14), stroke: withAlpha(colors.accent, 0.28), radius: theme.spacing.radius, lineWidth: 1 });
    if (this.#m.header > 0) {
      this.#paintHeader(context, theme, area);
    }
    for (let index = 0; index < 2; index += 1) {
      if (this.#numberRow) {
        // A phone's: no arrows, the numbers over the pictures give the order.
        continue;
      }
      const from = area.x + this.#stationX(index) + this.#station + 4;
      const to = area.x + this.#stationX(index + 1) - 4;
      drawArrow(context, { x: from, y: middle }, { x: to, y: middle }, { color: withAlpha(colors.accent, 0.85), width: 3, headSize: Math.min(12, (to - from) * 0.6) });
    }
  }

  /**
   * A plate under each step, a bold arrow in each gap.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   * @param {import("@magic8/engine/shared/geometry.js").Rect} area
   */
  #paintPlates(context, theme, area) {
    for (let index = 0; index < 3; index += 1) {
      paintPlate(context, theme, { x: area.x + this.#stationX(index), y: area.y, width: this.#station, height: area.height });
    }
    for (let index = 0; index < 2; index += 1) {
      paintBoldArrow(context, theme, { from: area.x + this.#stationX(index) + this.#station + 6, to: area.x + this.#stationX(index + 1) - 6, y: area.y + area.height / 2 });
    }
  }

  /**
   * "HOW RANKED WORKS" across the top, between two gold rules.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   * @param {import("@magic8/engine/shared/geometry.js").Rect} area
   */
  #paintHeader(context, theme, area) {
    const { colors } = theme;
    const text = "H O W   R A N K E D   W O R K S";
    const y = area.y + this.#m.pad + this.#m.header / 2 - 2;
    const center = area.x + area.width / 2;
    context.save();
    context.font = bodyFont(theme, theme.fonts.sizes.tiny, "bold");
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = colors.accent;
    context.fillText(text, center, y);
    const half = context.measureText(text).width / 2 + 12;
    context.strokeStyle = withAlpha(colors.accent, 0.45);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(area.x + this.#m.pad + 8, y);
    context.lineTo(center - half, y);
    context.moveTo(center + half, y);
    context.lineTo(area.x + area.width - this.#m.pad - 8, y);
    context.stroke();
    context.restore();
  }

  /**
   * The gold plaque under the trophy, as wide as the amount on it.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   * @param {{ x: number, y: number }} at the station's left edge and the plaque's top
   */
  #paintPlaque(context, theme, at) {
    const { colors } = theme;
    context.font = fontFor(theme, "small", "bold");
    const width = Math.min(this.#station, context.measureText(this.#jackpot ?? "").width + 22);
    const plaque = { x: at.x + (this.#station - width) / 2, y: at.y, width, height: PLAQUE.height };
    context.save();
    context.shadowColor = withAlpha(colors.letterbox, 0.6);
    context.shadowBlur = 6;
    const metal = context.createLinearGradient(plaque.x, plaque.y, plaque.x, plaque.y + plaque.height);
    metal.addColorStop(0, colors.accentLight);
    metal.addColorStop(0.55, colors.accent);
    metal.addColorStop(1, colors.accentDark);
    fillRoundedRect(context, plaque, { fill: metal, stroke: colors.accentDark, radius: plaque.height / 2, lineWidth: 1 });
    context.restore();
  }

  /**
   * A station's number on a small gold disc.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   * @param {{ x: number, y: number }} center
   * @param {number} number
   */
  #paintNumber(context, theme, center, number) {
    const { colors } = theme;
    const radius = this.#m.number;
    context.save();
    context.beginPath();
    context.arc(center.x, center.y, radius, 0, Math.PI * 2);
    context.fillStyle = colors.accent;
    context.fill();
    context.lineWidth = 1.5;
    context.strokeStyle = colors.accentDark;
    context.stroke();
    context.font = bodyFont(theme, radius * 1.3, "bold");
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = colors.accentText;
    context.fillText(String(number), center.x, center.y + 1);
    context.restore();
  }
}

/**
 * The sizes for a layout.
 * @param {{ compact: boolean, plates: boolean }} layout
 */
function metricsFor({ compact, plates }) {
  if (plates) {
    return PLATES;
  }
  return compact ? COMPACT : WIDE;
}

/**
 * A step's plate: dark, lit from the top in gold, a thin gilt rim.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../../theme/Theme.js").Theme} theme
 * @param {import("@magic8/engine/shared/geometry.js").Rect} plate
 */
function paintPlate(context, theme, plate) {
  const { colors } = theme;
  const radius = theme.spacing.radius;
  context.save();
  context.shadowColor = withAlpha(colors.letterbox, 0.55);
  context.shadowBlur = 10;
  context.shadowOffsetY = 3;
  fillRoundedRect(context, plate, { fill: withAlpha(colors.panelDark, 0.85), radius });
  context.restore();
  const glow = context.createLinearGradient(plate.x, plate.y, plate.x, plate.y + plate.height);
  glow.addColorStop(0, withAlpha(colors.accent, 0.2));
  glow.addColorStop(0.6, withAlpha(colors.accent, 0.04));
  glow.addColorStop(1, withAlpha(colors.accent, 0));
  fillRoundedRect(context, plate, { fill: glow, stroke: withAlpha(colors.accent, 0.55), radius, lineWidth: 1.25 });
}

/**
 * A bold gold arrow from one plate to the next: a tapered shaft and a broad head, outlined dark.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../../theme/Theme.js").Theme} theme
 * @param {{ from: number, to: number, y: number }} span
 */
function paintBoldArrow(context, theme, { from, to, y }) {
  const { colors } = theme;
  const length = Math.max(0, to - from);
  if (length < 8) {
    return;
  }
  const head = Math.min(14, length * 0.55);
  const shaft = 3.5;
  const half = head * 0.75;
  context.save();
  context.beginPath();
  context.moveTo(from, y - shaft / 2);
  context.lineTo(to - head, y - shaft);
  context.lineTo(to - head, y - half);
  context.lineTo(to, y);
  context.lineTo(to - head, y + half);
  context.lineTo(to - head, y + shaft);
  context.lineTo(from, y + shaft / 2);
  context.closePath();
  const gilt = context.createLinearGradient(0, y - half, 0, y + half);
  gilt.addColorStop(0, colors.accentLight);
  gilt.addColorStop(1, colors.accentDark);
  context.shadowColor = withAlpha(colors.accent, 0.5);
  context.shadowBlur = 6;
  context.fillStyle = gilt;
  context.fill();
  context.shadowBlur = 0;
  context.lineWidth = 1;
  context.strokeStyle = withAlpha(colors.letterbox, 0.6);
  context.stroke();
  context.restore();
}

/**
 * A phone's sizes for a guide this tall: the pictures give way so that the numbers' row, the titles and two lines of
 * words always fit.
 * @param {number} height
 */
function fittedCompact(height) {
  const room = height - 2 * COMPACT.pad - NUMBER_ROW - 8 - COMPACT.title - 2 - COMPACT_WORDS - COMPACT.bottom;
  return Object.freeze({ ...COMPACT, visual: Math.max(COMPACT_LEAST_VISUAL, Math.min(COMPACT.visual, room)) });
}
