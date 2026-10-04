/**
 * Word-wrapped text that marks names out in colour: `{Scrap Golem}` is the
 * name of a card (set bold in gold), `[End turn]` the label of something to
 * press (bold in the focus blue). Everything else reads in the plain colour.
 * The tutorial writes this way, so a player can tell at a glance which card
 * or which button a sentence is about.
 *
 * `wrapRich` is pure (the measuring is injected), so a test can check that
 * a text fits the room it is given.
 */
import { drawTextInRect } from "./drawing.js";
import { UiNode } from "./UiNode.js";
import { fontFor } from "../theme/Theme.js";

/** The room between two lines, over the font size. */
export const RICH_LINE_GAP = 4;

/** How a piece of text is set. */
export const RichStyle = Object.freeze({ PLAIN: "plain", NAME: "name", TERM: "term" });

/** The colour of each style (a theme colour key; the plain one is the node's own). */
const STYLE_COLORS = Object.freeze({ [RichStyle.NAME]: "accent", [RichStyle.TERM]: "focus" });
const OPENERS = Object.freeze({ "{": RichStyle.NAME, "[": RichStyle.TERM });
const CLOSERS = Object.freeze({ "}": RichStyle.NAME, "]": RichStyle.TERM });

/**
 * @typedef {Readonly<{ text: string, style: string }>} RichPiece
 * @typedef {readonly RichPiece[]} RichWord a word: the pieces set side by side with no space between ("{Golem}:" is two)
 * @typedef {readonly RichWord[]} RichLine
 */

/**
 * The words of a marked-up text, each in its pieces.
 * @param {string} text
 * @returns {RichWord[]}
 */
export function parseRich(text) {
  /** @type {RichWord[]} */
  const words = [];
  /** @type {RichPiece[]} */
  let word = [];
  let piece = "";
  let style = /** @type {string} */ (RichStyle.PLAIN);
  const endPiece = () => {
    if (piece.length > 0) {
      word.push(Object.freeze({ text: piece, style }));
    }
    piece = "";
  };
  const endWord = () => {
    endPiece();
    if (word.length > 0) {
      words.push(Object.freeze(word));
    }
    word = [];
  };
  for (const character of text) {
    if (style === RichStyle.PLAIN && character in OPENERS) {
      endPiece();
      style = OPENERS[/** @type {keyof typeof OPENERS} */ (character)];
    } else if (style !== RichStyle.PLAIN && CLOSERS[/** @type {keyof typeof CLOSERS} */ (character)] === style) {
      endPiece();
      style = RichStyle.PLAIN;
    } else if (/\s/.test(character)) {
      endWord();
    } else {
      piece += character;
    }
  }
  endWord();
  return words;
}

/**
 * The text without its marks, as it reads.
 * @param {string} text
 */
export function plainRich(text) {
  return parseRich(text)
    .map((word) => word.map((piece) => piece.text).join(""))
    .join(" ");
}

/**
 * Greedy word wrap of a marked-up text.
 * @param {(text: string, style: string) => number} measure the width of a piece in its style
 * @param {string} text
 * @param {number} maxWidth
 * @returns {RichLine[]}
 */
export function wrapRich(measure, text, maxWidth) {
  const space = measure(" ", RichStyle.PLAIN);
  /** @type {RichLine[]} */
  const lines = [];
  /** @type {RichWord[]} */
  let line = [];
  let width = 0;
  for (const word of parseRich(text)) {
    const wordWidth = word.reduce((sum, piece) => sum + measure(piece.text, piece.style), 0);
    const needed = line.length === 0 ? wordWidth : width + space + wordWidth;
    if (needed > maxWidth && line.length > 0) {
      lines.push(line);
      line = [word];
      width = wordWidth;
      continue;
    }
    line.push(word);
    width = needed;
  }
  if (line.length > 0) {
    lines.push(line);
  }
  return lines;
}

/**
 * Draws wrapped lines, each one `lineHeight` below the last, from `area`'s top.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {RichLine[]} lines
 * @param {{ area: import("@magic8/engine/shared/geometry.js").Rect, lineHeight: number, size: import("../theme/Theme.js").FontSize, color: string, align?: "left" | "center" }} style
 */
export function paintRichLines(context, theme, lines, { area, lineHeight, size, color, align = "left" }) {
  const measure = richMeasure(context, theme, size);
  const space = measure(" ", RichStyle.PLAIN);
  lines.forEach((line, index) => {
    const y = area.y + index * lineHeight;
    const lineWidth = line.reduce((sum, word, at) => sum + (at === 0 ? 0 : space) + word.reduce((total, piece) => total + measure(piece.text, piece.style), 0), 0);
    let x = align === "center" ? area.x + (area.width - lineWidth) / 2 : area.x;
    line.forEach((word, at) => {
      x += at === 0 ? 0 : space;
      for (const piece of word) {
        const pieceWidth = measure(piece.text, piece.style);
        const colorKey = /** @type {Record<string, string>} */ (STYLE_COLORS)[piece.style];
        drawTextInRect(context, piece.text, { x, y, width: pieceWidth, height: lineHeight }, { font: fontOf(theme, size, piece.style), color: colorKey === undefined ? color : theme.colors[colorKey], align: "left" });
        x += pieceWidth;
      }
    });
  });
}

/**
 * Measures pieces with the context, each in its own font.
 * @param {CanvasRenderingContext2D} context
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {import("../theme/Theme.js").FontSize} size
 * @returns {(text: string, style: string) => number}
 */
export function richMeasure(context, theme, size) {
  return (text, style) => {
    context.font = fontOf(theme, size, style);
    return context.measureText(text).width;
  };
}

/**
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {import("../theme/Theme.js").FontSize} size
 * @param {string} style
 */
function fontOf(theme, size, style) {
  return fontFor(theme, size, style === RichStyle.PLAIN ? "normal" : "bold");
}

/** A block of marked-up text; lines that do not fit the height are dropped. */
export class RichTextBlock extends UiNode {
  text;
  /** @type {import("../theme/Theme.js").FontSize} */
  size;
  /** @type {string | null} */
  colorKey;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, text: string, size?: import("../theme/Theme.js").FontSize, colorKey?: string | null }} options
   */
  constructor(options) {
    super(options);
    this.text = options.text;
    this.size = options.size ?? "body";
    this.colorKey = options.colorKey ?? null;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const lineHeight = theme.fonts.sizes[this.size] + RICH_LINE_GAP;
    const lines = wrapRich(richMeasure(context, theme, this.size), this.text, area.width).slice(0, Math.max(0, Math.floor(area.height / lineHeight)));
    const color = this.colorKey === null ? theme.colors.text : theme.colors[this.colorKey] ?? theme.colors.text;
    paintRichLines(context, theme, lines, { area, lineHeight, size: this.size, color });
  }
}
