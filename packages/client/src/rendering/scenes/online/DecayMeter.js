/**
 * What today's rating decay asks of a player among the season's first
 * (docs/tcg/09-classificata.md), as a flat pill in the bar's own style: a
 * dot for each ranked game by hand the day asks of their place (empty, ringed in red: to play; green: played), then what is left
 * to play and, in red, the rating lost at midnight UTC. The pill is as long
 * as what it says, from the left of its room; its border is red at risk,
 * green once safe. Brief (`brief`: a phone's top bar), its words are only
 * the rating at stake ("−50") or "Safe". Drawing only, unless it is given
 * something to do (`onActivate`): then it is a button, ringed under the
 * pointer and when focused.
 */
import { SoundCue } from "../../../application/audio/SoundCue.js";
import { withAlpha } from "../../theme/color.js";
import { bodyFont } from "../../theme/Theme.js";
import { fillRoundedRect } from "../../ui/drawing.js";
import { UiNode } from "../../ui/UiNode.js";
import { rankedLeft } from "../lobby/lobbyText.js";

/**
 * Shares of the pill's height: the room before the dots, a dot's radius and the room each takes, the gap before the
 * words, the room after them, the words' size and the least they shrink to.
 */
const SHARE = Object.freeze({ start: 0.3, dot: 0.17, dotStep: 0.46, wordsGap: 0.24, end: 0.42, words: 0.46, least: 0.32 });
/** The space between two runs of the words, in their size. */
const WORD_SPACE = 0.32;
/** Most dots drawn: past it, the count is in the words only. */
const MOST_DOTS = 5;

/**
 * A run of the words, drawn in its own colour.
 * @typedef {Readonly<{ text: string, colorKey: string, bold: boolean, scale?: number }>} Words
 */

/**
 * The words on the pill: "Play 2 more ranked today or −50", "Safe today · 3/3 ranked".
 * @param {import("../../../application/ports/RankingApi.contract.js").Decay} decay
 */
export function decayMeterText(decay) {
  return decayWords(decay, false)
    .map((words) => words.text)
    .join(" ");
}

/**
 * The words on a brief pill, beside its dots: "−50", "Safe".
 * @param {import("../../../application/ports/RankingApi.contract.js").Decay} decay
 */
export function decayBriefText(decay) {
  return decayWords(decay, true)
    .map((words) => words.text)
    .join(" ");
}

/**
 * The pill's words, run by run: what is left to play, then the rating at stake in red; or that the day is safe.
 * @param {import("../../../application/ports/RankingApi.contract.js").Decay} decay
 * @param {boolean} brief
 * @returns {readonly Words[]}
 */
function decayWords(decay, brief) {
  const games = decay.games ?? 1;
  if (decay.safe) {
    const safe = { text: brief ? "Safe" : "Safe today", colorKey: "success", bold: true };
    return brief ? [safe] : [safe, { text: `· ${Math.min(decay.played ?? games, games)}/${games} ranked`, colorKey: "textMuted", bold: false }];
  }
  const stake = { text: `−${decay.points}`, colorKey: "danger", bold: true, scale: 1.12 };
  return brief ? [stake] : [{ text: `${rankedLeft(decay)} today`, colorKey: "text", bold: true }, { text: "or", colorKey: "textMuted", bold: false }, stake];
}

export class DecayMeter extends UiNode {
  /** The words on it. */
  text;
  /** Whether today's games are played. */
  safe;
  /** What a click does, or null for a pill that only shows. @type {(() => void) | null} */
  onActivate;
  /** The words, run by run. @type {readonly Words[]} */
  #words;
  #games;
  #played;

  /**
   * How wide a brief pill this tall needs to be for this day's dots and words.
   * @param {import("../../../application/ports/RankingApi.contract.js").Decay} decay
   * @param {number} height
   */
  static briefWidth(decay, height) {
    const dots = Math.min(decay.games ?? 1, MOST_DOTS);
    const words = decayBriefText(decay).length * height * SHARE.words * 0.62;
    return Math.ceil(height * (SHARE.start + dots * SHARE.dotStep + SHARE.wordsGap + SHARE.end) + words);
  }

  /**
   * @param {{ id?: string, x: number, y: number, width: number, height: number, decay: import("../../../application/ports/RankingApi.contract.js").Decay, brief?: boolean, onActivate?: (() => void) | null }} options
   */
  constructor({ id = "ranked.decay", decay, brief = false, onActivate = null, ...frame }) {
    super({ id, ...frame });
    this.onActivate = onActivate;
    this.passthrough = onActivate === null;
    this.interactive = onActivate !== null;
    this.focusable = onActivate !== null;
    this.activationCue = onActivate === null ? null : SoundCue.UI_CLICK;
    this.#words = decayWords(decay, brief);
    this.text = this.#words.map((words) => words.text).join(" ");
    this.safe = decay.safe;
    this.#games = decay.games ?? 1;
    this.#played = Math.min(decay.played ?? (decay.safe ? this.#games : 0), this.#games);
  }

  activate() {
    if (this.onActivate !== null && this.isEffectivelyEnabled && this.isEffectivelyVisible) {
      this.onActivate();
    }
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const h = area.height;
    const middle = area.y + h / 2;
    const dotsX = area.x + h * SHARE.start;
    const wordsX = (this.#games <= MOST_DOTS ? dotsX + this.#games * h * SHARE.dotStep : dotsX) + h * SHARE.wordsGap;
    const size = this.#wordsSize(context, theme, { room: area.x + area.width - h * SHARE.end - wordsX, height: h });
    const end = Math.min(area.x + area.width, wordsX + this.#wordsWidth(context, theme, size) + h * SHARE.end);
    context.save();
    this.#paintFace(context, theme, { ...area, width: end - area.x });
    if (this.#games <= MOST_DOTS) {
      this.#paintDots(context, theme, { x: dotsX, y: middle, height: h });
    }
    this.#paintWords(context, theme, { x: wordsX, y: middle, size, height: h });
    context.restore();
  }

  /**
   * The pill, flat as the bar's chips are: its border red at risk, green once safe, ringed under the pointer and when
   * focused (when it can be clicked).
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   * @param {import("@magic8/engine/shared/geometry.js").Rect} area
   */
  #paintFace(context, theme, area) {
    const { panel, danger, success, focus, accent } = theme.colors;
    const ringed = this.onActivate !== null && (this.hovered || this.focused);
    let stroke = this.safe ? success : danger;
    if (this.focused) {
      stroke = focus;
    } else if (ringed) {
      stroke = accent;
    }
    fillRoundedRect(context, area, { fill: withAlpha(panel, 0.92), stroke, radius: area.height / 2, lineWidth: ringed || this.focused ? 2.5 : 1.5 });
  }

  /**
   * A dot for each game the day asks for — green for those played, empty and ringed in red for the others — from
   * `at.x` along the middle line `at.y`.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   * @param {{ x: number, y: number, height: number }} at `height`: the pill's
   */
  #paintDots(context, theme, at) {
    const { danger, success, panelDark } = theme.colors;
    const radius = at.height * SHARE.dot;
    const step = at.height * SHARE.dotStep;
    context.lineWidth = Math.max(1.5, radius * 0.32);
    for (let index = 0; index < this.#games; index += 1) {
      const played = index < this.#played;
      context.beginPath();
      context.arc(at.x + index * step + step / 2, at.y, radius, 0, 2 * Math.PI);
      context.fillStyle = played ? success : panelDark;
      context.fill();
      context.strokeStyle = played ? success : danger;
      context.stroke();
    }
  }

  /**
   * The size the words are drawn at: shrunk (to a point) to fit in `room`.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   * @param {{ room: number, height: number }} at
   */
  #wordsSize(context, theme, { room, height }) {
    const size = height * SHARE.words;
    const width = this.#wordsWidth(context, theme, size);
    return width > room ? Math.max(height * SHARE.least, (size * Math.max(0, room)) / width) : size;
  }

  /**
   * How wide the words are at `size`, with the space between their runs.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   * @param {number} size
   */
  #wordsWidth(context, theme, size) {
    return this.#words.reduce((total, words, index) => {
      context.font = bodyFont(theme, size * (words.scale ?? 1), words.bold ? "bold" : "normal");
      return total + context.measureText(words.text).width + (index > 0 ? size * WORD_SPACE : 0);
    }, 0);
  }

  /**
   * The words, run by run, from `at.x` along the middle line `at.y`, at `at.size`.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   * @param {{ x: number, y: number, size: number, height: number }} at
   */
  #paintWords(context, theme, at) {
    context.textAlign = "left";
    context.textBaseline = "middle";
    let x = at.x;
    for (const words of this.#words) {
      context.font = bodyFont(theme, at.size * (words.scale ?? 1), words.bold ? "bold" : "normal");
      context.fillStyle = theme.colors[words.colorKey] ?? theme.colors.text;
      context.fillText(words.text, x, at.y + 1);
      x += context.measureText(words.text).width + at.size * WORD_SPACE;
    }
  }
}
