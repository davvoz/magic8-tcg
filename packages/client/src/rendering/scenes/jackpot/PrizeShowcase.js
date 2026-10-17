/**
 * The season's prize, on the Ranked screen, so that what ranked play is
 * for is plain at a glance: a gold panel with the prize pool in large gilt
 * type, the time the season has left (ticking), how much it has grown, and
 * who shares it — the top three of the leaderboard, standing on a podium
 * (gold, silver, bronze), each with their portrait, their share and their
 * prize; an empty step is an open seat. Then where the player stands, and
 * the way to the full leaderboard.
 *
 * Wide, the words on the left and the podium on the right, with a
 * Leaderboard button; on a phone the same in a short band, the whole band
 * opening the leaderboard. `tick()` rewrites the countdown when its second
 * changes.
 */
import { describeJackpot } from "../../../application/jackpot/describeJackpot.js";
import { mix, withAlpha } from "../../theme/color.js";
import { bodyFont, displayFont } from "../../theme/Theme.js";
import { AvatarNode } from "../../ui/AvatarNode.js";
import { drawSteemMark } from "../../ui/glyphs.js";
import { Button } from "../../ui/Button.js";
import { roundedRectPath, verticalGradient } from "../../ui/drawing.js";
import { Label } from "../../ui/Label.js";
import { Panel, SMALL_PANEL_TITLE_INSET } from "../../ui/Panel.js";
import { TextBlock } from "../../ui/TextBlock.js";

/** How tall the showcase is, wide and on a phone (the lobby sizes its band with it). */
export const SHOWCASE_HEIGHT = Object.freeze({ wide: 270, compact: 104 });

/**
 * The layouts: the side padding (clear of the small painted corners), the room under the podium and the button, the words' share of the width, the amount's size, each place's step height and portrait size,
 * the numeral's size and the line sizes.
 */
const WIDE = Object.freeze({ pad: SMALL_PANEL_TITLE_INSET, foot: 18, words: 0.46, amount: 50, steps: Object.freeze([110, 88, 70]), avatars: Object.freeze([56, 46, 46]), numeral: 26, name: 20, gap: 4, button: 44 });
const COMPACT = Object.freeze({ pad: SMALL_PANEL_TITLE_INSET, foot: 8, words: 0.46, amount: 28, steps: Object.freeze([34, 26, 20]), avatars: Object.freeze([26, 22, 22]), numeral: 0, name: 14, gap: 2, button: 0 });
/** Where each place stands, left to right: second, first, third. */
const PODIUM_ORDER = Object.freeze([1, 0, 2]);

/**
 * @typedef {Readonly<{ account: string | null, standing: import("../../../application/ports/RankingApi.contract.js").Standing | null }>} Viewer
 *   the player looking: their account (their place is marked "You") and their standing
 */

export class PrizeShowcase extends Panel {
  #jackpot;
  #now;
  #m;
  #compact;
  #viewer;
  /** @type {Label | null} */
  #countdown = null;
  #shown = "";

  /**
   * @param {{ id?: string, x: number, y: number, width: number, height: number, jackpot: import("../../../application/ports/JackpotApi.contract.js").Jackpot, now: () => number, compact: boolean, viewer: Viewer, onLeaderboard: () => void }} options
   */
  constructor({ id = "prize", x, y, width, height, jackpot, now, compact, viewer, onLeaderboard }) {
    super({ id, x, y, width, height, glowKey: "accent", smallCorners: true, onActivate: compact ? onLeaderboard : null });
    this.#jackpot = jackpot;
    this.#now = now;
    this.#compact = compact;
    this.#viewer = viewer;
    this.#m = compact ? COMPACT : WIDE;
    const text = describeJackpot(jackpot, now());
    this.#buildWords(text, onLeaderboard);
    this.#buildPodium(text);
    this.#shown = text.countdown;
  }

  /**
   * Rewrites the countdown when the second it shows has changed.
   * @returns {boolean} whether the showcase needs drawing again
   */
  tick() {
    const line = describeJackpot(this.#jackpot, this.#now()).countdown;
    if (this.#countdown === null || line === this.#shown) {
      return false;
    }
    this.#shown = line;
    this.#countdown.text = line;
    return true;
  }

  /** The words' column: from the panel's left edge to where the podium starts. */
  get #wordsWidth() {
    return Math.round(this.width * this.#m.words) - this.#m.pad;
  }

  /**
   * The title, the pool (drawn in `paint`), the countdown, the growth, who shares it, where the player stands and the button.
   * @param {import("../../../application/jackpot/describeJackpot.js").JackpotText} text
   * @param {() => void} onLeaderboard
   */
  #buildWords(text, onLeaderboard) {
    const m = this.#m;
    const width = this.#wordsWidth;
    const line = (/** @type {number} */ y, /** @type {number} */ height, /** @type {Partial<ConstructorParameters<typeof Label>[0]> & { text: string }} */ options) =>
      this.add(new Label({ x: m.pad, y, width, height, align: "left", fit: true, ...options }));
    const season = this.#jackpot.season.name.toUpperCase();
    const places = text.places.length;
    if (this.#compact) {
      line(6, 16, { id: "prize.title", text: `${season} · PRIZE POOL`, size: "micro", weight: "bold", colorKey: "accent" });
      this.#countdown = line(58, 20, { id: "prize.countdown", text: text.countdown, size: "small", weight: "bold", colorKey: "text" });
      line(78, 18, { id: "prize.share", text: `Top ${places} share it · tap for the leaderboard`, size: "micro", colorKey: "textMuted" });
      return;
    }
    line(14, 20, { id: "prize.title", text: `${season} · PRIZE POOL`, size: "tiny", weight: "bold", colorKey: "accent" });
    this.#countdown = line(98, 26, { id: "prize.countdown", text: text.countdown, size: "body", weight: "bold", colorKey: "text" });
    if (text.growth !== null) {
      line(124, 20, { id: "prize.growth", text: text.growth, size: "small", weight: "bold", colorKey: "success" });
    }
    this.add(new TextBlock({ id: "prize.share", x: m.pad, y: 150, width, height: 40, text: `When the season ends, the top ${places} of the leaderboard share it: ${text.places.map((place) => place.share).join(" · ")}.`, size: "small", colorKey: "textMuted" }));
    const buttonY = this.height - m.foot - m.button;
    const buttonWidth = Math.min(150, Math.round(width * 0.4));
    this.add(new Button({ id: "prize.leaderboard", x: m.pad, y: buttonY, width: buttonWidth, height: m.button, text: "Leaderboard", textSize: "small", onActivate: onLeaderboard }));
    const you = yourPlaceText(this.#viewer.standing);
    this.add(new Label({ id: "prize.you", x: m.pad + buttonWidth + 12, y: buttonY, width: width - buttonWidth - 12, height: m.button, text: you, size: "small", weight: "bold", colorKey: "accentLight", align: "left", fit: true, avatar: this.#viewer.account }));
  }

  /**
   * The paying places on their steps (their blocks are drawn in `paint`): each one's portrait, name, share and prize.
   * @param {import("../../../application/jackpot/describeJackpot.js").JackpotText} text
   */
  #buildPodium(text) {
    const m = this.#m;
    text.places.slice(0, 3).forEach((place, index) => {
      const step = this.#step(index);
      const avatar = m.avatars[index];
      const nameY = step.y - m.gap - m.name;
      const avatarY = nameY - m.gap - avatar;
      const mine = place.account !== null && place.account === this.#viewer.account;
      if (place.account !== null) {
        this.add(new AvatarNode({ id: `prize.avatar.${index + 1}`, x: step.x + (step.width - avatar) / 2, y: avatarY, size: avatar, account: place.account }));
      }
      const name = place.account === null ? "Open seat" : `@${place.account}`;
      this.add(new Label({ id: `prize.name.${index + 1}`, x: step.x, y: nameY, width: step.width, height: m.name, text: mine ? `${name} · You` : name, size: this.#compact ? "micro" : "small", weight: "bold", colorKey: labelColor(place.account, mine), fit: true }));
      const prize = this.#compact ? place.figure : `${place.share} · ${place.amount}`;
      const prizeHeight = this.#compact ? 14 : 22;
      this.add(new Label({ id: `prize.amount.${index + 1}`, x: step.x + 4, y: step.y + step.height - prizeHeight - (this.#compact ? 2 : 6), width: step.width - 8, height: prizeHeight, text: prize, size: this.#compact ? "micro" : "small", weight: "bold", colorKey: "accentText", fit: true }));
    });
  }

  /**
   * A place's step: its column on the podium (second, first, third from the left) and its height.
   * @param {number} index 0 for the first place
   */
  #step(index) {
    const m = this.#m;
    const left = Math.round(this.width * m.words) + m.pad;
    const width = (this.width - left - m.pad) / 3;
    const height = m.steps[index];
    const column = PODIUM_ORDER[index];
    return { x: left + column * width + 4, y: this.height - m.foot - height, width: width - 8, height };
  }

  /**
   * The panel, the pool in large gilt type, the steps with their numerals, the empty seats and the crown.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    super.paint(context, theme);
    const area = this.bounds;
    const m = this.#m;
    const text = describeJackpot(this.#jackpot, this.#now());
    context.save();
    roundedRectPath(context, area, theme.spacing.radius);
    context.clip();
    paintGlory(context, theme, { x: area.x + Math.round(this.width * m.words) + (this.width - Math.round(this.width * m.words)) / 2, y: area.y + area.height * 0.42, radius: area.height * 0.75 });
    context.restore();
    // STEEM's mark, then the pool beside it.
    const amountY = area.y + (this.#compact ? 41 : 66);
    const mark = m.amount * 0.42;
    drawSteemMark(context, theme, { x: area.x + m.pad + mark, y: amountY }, mark);
    const markRoom = 2 * mark + m.amount * 0.22;
    paintAmount(context, theme, { x: area.x + m.pad + markRoom, y: amountY, size: m.amount, width: this.#wordsWidth - markRoom }, text.amount);
    text.places.slice(0, 3).forEach((place, index) => {
      const step = this.#step(index);
      const box = { x: area.x + step.x, y: area.y + step.y, width: step.width, height: step.height };
      paintStep(context, theme, box, { index, numeral: m.numeral });
      const size = m.avatars[index];
      const portrait = { x: box.x + box.width / 2, y: box.y - m.gap - m.name - m.gap - size / 2 };
      if (place.account === null) {
        paintOpenSeat(context, theme, portrait, size / 2);
      }
      if (index === 0) {
        paintCrown(context, theme, { x: portrait.x, y: portrait.y - size / 2 - size * 0.22 }, size * 0.5);
      }
    });
  }
}

/**
 * Where the player stands in the season, in a line.
 * @param {import("../../../application/ports/RankingApi.contract.js").Standing | null} standing
 */
export function yourPlaceText(standing) {
  if (standing === null || standing.season === null) {
    return "Your place: —";
  }
  if (!standing.eligible) {
    return "Unlock Ranked to compete";
  }
  if (standing.games === 0) {
    return "You: not ranked yet · play a game";
  }
  return standing.provisional || standing.rank === null ? `You: provisional · rating ${standing.rating}` : `You: #${standing.rank} · rating ${standing.rating}`;
}

/**
 * @param {string | null} account
 * @param {boolean} mine
 */
function labelColor(account, mine) {
  if (mine) {
    return "accentLight";
  }
  return account === null ? "textMuted" : "text";
}

/**
 * The metals of the three places: gold, silver, bronze, from the theme's gold, its greys and its ember.
 * @param {import("../../theme/Theme.js").Theme} theme
 * @param {number} index
 */
function metalOf(theme, index) {
  const { colors } = theme;
  const ember = colors.factions.ember ?? colors.factions.neutral;
  const metals = [
    { light: colors.accentLight, base: colors.accent, dark: colors.accentDark },
    { light: colors.text, base: mix(colors.text, colors.textMuted, 0.5), dark: mix(colors.textMuted, colors.panelDark, 0.4) },
    { light: mix(ember.light, colors.accentLight, 0.4), base: mix(ember.base, colors.accentDark, 0.45), dark: mix(ember.dark, colors.panelDark, 0.3) },
  ];
  return metals[index] ?? metals[2];
}

/**
 * A step of the podium: a block of polished metal, its numeral at the top.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../../theme/Theme.js").Theme} theme
 * @param {import("@magic8/engine/shared/geometry.js").Rect} box
 * @param {{ index: number, numeral: number }} look `numeral`: its size (0: none, a phone's)
 */
function paintStep(context, theme, box, { index, numeral }) {
  const metal = metalOf(theme, index);
  context.save();
  context.shadowColor = withAlpha(theme.colors.letterbox, 0.6);
  context.shadowBlur = 8;
  context.fillStyle = verticalGradient(context, box, [
    [0, metal.light],
    [0.35, metal.base],
    [1, metal.dark],
  ]);
  roundedRectPath(context, box, 6);
  context.fill();
  context.shadowBlur = 0;
  context.lineWidth = 1.5;
  context.strokeStyle = withAlpha(metal.dark, 0.9);
  context.stroke();
  // A sheen across the top.
  context.fillStyle = withAlpha(theme.colors.text, 0.18);
  context.fillRect(box.x + 3, box.y + 3, box.width - 6, Math.min(6, box.height / 6));
  if (numeral > 0) {
    context.font = displayFont(theme, numeral);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = theme.colors.accentText;
    context.fillText(String(index + 1), box.x + box.width / 2, box.y + numeral * 0.85);
  }
  context.restore();
}

/**
 * A small gilt crown over the leader.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../../theme/Theme.js").Theme} theme
 * @param {{ x: number, y: number }} center
 * @param {number} width
 */
function paintCrown(context, theme, center, width) {
  const { colors } = theme;
  const half = width / 2;
  const height = width * 0.62;
  const top = center.y - height / 2;
  const base = center.y + height / 2;
  context.save();
  context.beginPath();
  context.moveTo(center.x - half, base);
  context.lineTo(center.x - half, top + height * 0.25);
  context.lineTo(center.x - half * 0.5, top + height * 0.6);
  context.lineTo(center.x, top);
  context.lineTo(center.x + half * 0.5, top + height * 0.6);
  context.lineTo(center.x + half, top + height * 0.25);
  context.lineTo(center.x + half, base);
  context.closePath();
  const gilt = context.createLinearGradient(0, top, 0, base);
  gilt.addColorStop(0, colors.accentLight);
  gilt.addColorStop(1, colors.accentDark);
  context.shadowColor = withAlpha(colors.accent, 0.6);
  context.shadowBlur = width * 0.3;
  context.fillStyle = gilt;
  context.fill();
  context.shadowBlur = 0;
  context.lineWidth = 1;
  context.strokeStyle = colors.accentDark;
  context.stroke();
  context.restore();
}

/**
 * Where nobody stands yet: a dashed ring with a question mark.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../../theme/Theme.js").Theme} theme
 * @param {{ x: number, y: number }} center
 * @param {number} radius
 */
function paintOpenSeat(context, theme, center, radius) {
  const { colors } = theme;
  context.save();
  context.beginPath();
  context.arc(center.x, center.y, radius - 1, 0, Math.PI * 2);
  context.fillStyle = withAlpha(colors.accent, 0.08);
  context.fill();
  context.setLineDash([4, 4]);
  context.lineWidth = 1.5;
  context.strokeStyle = withAlpha(colors.accent, 0.7);
  context.stroke();
  context.setLineDash([]);
  context.font = bodyFont(theme, radius, "bold");
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = colors.accent;
  context.fillText("?", center.x, center.y + 1);
  context.restore();
}

/**
 * The pool in large gilt type with a glow, shrunk to fit the width.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../../theme/Theme.js").Theme} theme
 * @param {{ x: number, y: number, size: number, width: number }} place `y`: the line's middle
 * @param {string} amount
 */
function paintAmount(context, theme, { x, y, size, width }, amount) {
  const { colors } = theme;
  context.save();
  context.font = displayFont(theme, size);
  const measured = context.measureText(amount).width;
  const fitted = measured > width && measured > 0 ? (size * width) / measured : size;
  context.font = displayFont(theme, fitted);
  context.textAlign = "left";
  context.textBaseline = "middle";
  const gilt = context.createLinearGradient(0, y - fitted / 2, 0, y + fitted / 2);
  gilt.addColorStop(0, colors.accentLight);
  gilt.addColorStop(0.55, colors.accent);
  gilt.addColorStop(1, colors.accentDark);
  context.shadowColor = withAlpha(colors.accent, 0.55);
  context.shadowBlur = fitted * 0.35;
  context.fillStyle = gilt;
  context.fillText(amount, x, y);
  context.restore();
}

/**
 * A soft gold light behind the podium.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../../theme/Theme.js").Theme} theme
 * @param {{ x: number, y: number, radius: number }} light
 */
function paintGlory(context, theme, { x, y, radius }) {
  const glow = context.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, withAlpha(theme.colors.accent, 0.22));
  glow.addColorStop(1, withAlpha(theme.colors.accent, 0));
  context.save();
  context.fillStyle = glow;
  context.fillRect(x - radius, y - radius, 2 * radius, 2 * radius);
  context.restore();
}
