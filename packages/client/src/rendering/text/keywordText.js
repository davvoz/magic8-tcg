/**
 * A card's keywords (its abilities: Haste, Trample…) stand out wherever the
 * card is written, in gold and bold, as a phone's board shows them: on the
 * card's rules text, in the lists' subtitles and in the card's details.
 * `keywordRuns` and `rulesTextFor` are pure; `drawRuns` paints one line of
 * runs left-aligned, and `wrapRuns` word-wraps a text measuring each run in
 * its own font.
 */
import { capitalize, ellipsize, wrapText } from "./textUtils.js";

/**
 * @typedef {Readonly<{ text: string, keyword: boolean }>} TextRun
 * @typedef {Readonly<{ font: string, keywordFont: string, color: string, keywordColor: string }>} RunStyle
 */

const ELLIPSIS = "…";

/** @param {string} text */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Splits a text into runs, each keyword (whole word, any case) a run of its own.
 * @param {string} text
 * @param {readonly string[]} keywords
 * @returns {TextRun[]}
 */
export function keywordRuns(text, keywords) {
  if (keywords.length === 0 || text.length === 0) {
    return [{ text, keyword: false }];
  }
  const pattern = new RegExp(`\\b(?:${keywords.map(escapeRegExp).join("|")})\\b`, "gi");
  /** @type {TextRun[]} */
  const runs = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) {
      runs.push({ text: text.slice(last, start), keyword: false });
    }
    runs.push({ text: match[0], keyword: true });
    last = start + match[0].length;
  }
  if (last < text.length) {
    runs.push({ text: text.slice(last), keyword: false });
  }
  return runs;
}

/**
 * The rules text with every keyword named: those the text does not mention
 * lead it ("Haste. …"), so each keyword is read where the rules are.
 * @param {{ text: string, keywords?: readonly string[] }} card
 */
export function rulesTextFor({ text, keywords = [] }) {
  const missing = keywords.filter((keyword) => keywordRuns(text, [keyword]).every((run) => !run.keyword));
  return [...missing.map((keyword) => `${capitalize(keyword)}.`), text].filter((part) => part.length > 0).join(" ");
}

/**
 * How wide a line of runs is, each in its font.
 * @param {CanvasRenderingContext2D} context
 * @param {readonly TextRun[]} runs
 * @param {RunStyle} style
 */
export function measureRuns(context, runs, style) {
  let width = 0;
  for (const run of runs) {
    context.font = run.keyword ? style.keywordFont : style.font;
    width += context.measureText(run.text).width;
  }
  return width;
}

/**
 * Word-wraps a text into lines of runs, the keywords measured in their own (bold) font.
 * @param {CanvasRenderingContext2D} context
 * @param {string} text
 * @param {{ keywords: readonly string[], width: number, style: RunStyle }} wrap
 * @returns {TextRun[][]}
 */
export function wrapRuns(context, text, { keywords, width, style }) {
  const measure = (/** @type {string} */ line) => measureRuns(context, keywordRuns(line, keywords), style);
  return wrapText(measure, text, width).map((line) => keywordRuns(line, keywords));
}

/**
 * Paints a line of runs left-aligned in `area`, vertically centred. A line
 * wider than the area is cut where it overflows and ends with an ellipsis.
 * @param {CanvasRenderingContext2D} context
 * @param {readonly TextRun[]} runs
 * @param {import("@magic8/engine/shared/geometry.js").Rect} area
 * @param {RunStyle} style
 */
export function drawRuns(context, runs, area, style) {
  const fits = measureRuns(context, runs, style) <= area.width;
  context.font = style.font;
  const ellipsisWidth = fits ? 0 : context.measureText(ELLIPSIS).width;
  context.textAlign = "left";
  context.textBaseline = "middle";
  const y = area.y + area.height / 2;
  const right = area.x + area.width;
  let x = area.x;
  for (const run of runs) {
    context.font = run.keyword ? style.keywordFont : style.font;
    context.fillStyle = run.keyword ? style.keywordColor : style.color;
    const measure = (/** @type {string} */ text) => context.measureText(text).width;
    const width = measure(run.text);
    if (x + width + ellipsisWidth <= right) {
      context.fillText(run.text, x, y);
      x += width;
      continue;
    }
    context.fillText(ellipsize(measure, `${run.text}${ELLIPSIS}`, right - x), x, y);
    return;
  }
}
