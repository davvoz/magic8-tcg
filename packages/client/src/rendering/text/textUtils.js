/**
 * Text layout helpers. `measure` is injected (typically
 * `(text) => context.measureText(text).width` with the font already set) so
 * the functions are pure and testable.
 */

const MAX_LINES = 64;

/**
 * Greedy word wrap. Words longer than `maxWidth` are broken by character.
 * @param {(text: string) => number} measure
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string[]}
 */
export function wrapText(measure, text, maxWidth) {
  const lines = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter((token) => token.length > 0)) {
      const candidate = line.length === 0 ? word : `${line} ${word}`;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line.length > 0) {
        lines.push(line);
      }
      line = breakLongWord(measure, word, maxWidth, lines);
      if (lines.length >= MAX_LINES) {
        return lines;
      }
    }
    lines.push(line);
  }
  return lines.slice(0, MAX_LINES);
}

/**
 * Pushes full-width chunks of a long word and returns the remainder.
 * @param {(text: string) => number} measure
 * @param {string} word
 * @param {number} maxWidth
 * @param {string[]} lines
 */
function breakLongWord(measure, word, maxWidth, lines) {
  let chunk = "";
  for (const character of word) {
    if (measure(chunk + character) > maxWidth && chunk.length > 0) {
      lines.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  return chunk;
}

/**
 * Upper-cases the first character (for type and faction labels from data).
 * @param {string} text
 */
export function capitalize(text) {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

/**
 * Truncates with an ellipsis when the text does not fit.
 * @param {(text: string) => number} measure
 * @param {string} text
 * @param {number} maxWidth
 */
export function ellipsize(measure, text, maxWidth) {
  if (measure(text) <= maxWidth) {
    return text;
  }
  const ellipsis = "…";
  let kept = text;
  while (kept.length > 0 && measure(kept + ellipsis) > maxWidth) {
    kept = kept.slice(0, -1);
  }
  return kept + ellipsis;
}
