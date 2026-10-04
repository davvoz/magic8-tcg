/**
 * One Info topic as a scrolling article: headings in the display face,
 * paragraphs, and bullets (or numbered steps) with a hanging indent. The
 * text is word-wrapped on the first draw (wrapping needs the canvas to
 * measure); it scrolls with the wheel, a drag, or the scene's page keys.
 * Only the lines inside the visible window are painted.
 */
import { drawTextInRect } from "../../ui/drawing.js";
import { ScrollList } from "../../ui/ScrollList.js";
import { UiNode } from "../../ui/UiNode.js";
import { wrapText } from "../../text/textUtils.js";
import { displayFont, fontFor } from "../../theme/Theme.js";

/** The type sizes and spacing, wide and compact (a phone in landscape). */
const METRICS = Object.freeze({
  wide: Object.freeze({ heading: 25, text: "body", lineGap: 6, blockGap: 10, headingGap: 22, indent: 30 }),
  compact: Object.freeze({ heading: 18, text: "small", lineGap: 4, blockGap: 7, headingGap: 14, indent: 22 }),
});
const BULLET = "•";

/**
 * @typedef {{ text: string, x: number, y: number, width: number, height: number, font: string, colorKey: string }} ArticleLine
 *   a line of text, or a bullet's marker, at its place in the article
 */

export class InfoArticle extends ScrollList {
  /** @type {readonly import("../../../application/info/infoTopics.js").InfoBlock[]} */
  #blocks;
  #compact;
  /** Where to start once laid out (a rebuild keeps the reader's place). */
  #initialScroll;
  /** @type {(scrollY: number) => void} */
  #onScroll;
  /** Laid out on the first draw. @type {ArticleLine[] | null} */
  #lines = null;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, blocks: readonly import("../../../application/info/infoTopics.js").InfoBlock[], compact?: boolean, scrollY?: number, onScroll?: (scrollY: number) => void }} options
   */
  constructor(options) {
    super(options);
    this.#blocks = options.blocks;
    this.#compact = options.compact === true;
    this.#initialScroll = options.scrollY ?? 0;
    this.#onScroll = options.onScroll ?? (() => undefined);
    this.add(new ArticleLines(() => this.#lines ?? [], () => this.bounds));
  }

  /** Whether the text has been laid out (it is, from the first draw on). */
  get laidOut() {
    return this.#lines !== null;
  }

  /** @param {number} offset */
  scrollTo(offset) {
    const changed = super.scrollTo(offset);
    if (this.#lines !== null) {
      this.#onScroll(this.scrollY);
    }
    return changed;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  draw(context, theme) {
    if (!this.visible) {
      return;
    }
    if (this.#lines === null) {
      const { lines, height } = this.#layOut(context, theme);
      this.contentHeight = height;
      const [painter] = this.content.children;
      painter.width = this.rowWidth;
      painter.height = height;
      this.#lines = lines;
      super.scrollTo(this.#initialScroll);
    }
    super.draw(context, theme);
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   * @returns {{ lines: ArticleLine[], height: number }}
   */
  #layOut(context, theme) {
    const m = this.#compact ? METRICS.compact : METRICS.wide;
    const width = this.rowWidth;
    const measure = (/** @type {string} */ text) => context.measureText(text).width;
    const textFont = fontFor(theme, /** @type {import("../../theme/Theme.js").FontSize} */ (m.text));
    const textHeight = theme.fonts.sizes[m.text] + m.lineGap;
    const headingFont = displayFont(theme, m.heading);
    const headingHeight = m.heading + m.lineGap;
    /** @type {ArticleLine[]} */
    const lines = [];
    let y = 0;
    this.#blocks.forEach((block, index) => {
      if (block.kind === "heading") {
        y += index === 0 ? 0 : m.headingGap;
        context.font = headingFont;
        for (const text of wrapText(measure, block.text, width)) {
          lines.push({ text, x: 0, y, width, height: headingHeight, font: headingFont, colorKey: "accentLight" });
          y += headingHeight;
        }
        y += m.blockGap / 2;
        return;
      }
      const indent = block.kind === "bullet" ? m.indent : 0;
      if (block.kind === "bullet") {
        lines.push({ text: block.marker ?? BULLET, x: 0, y, width: indent, height: textHeight, font: block.marker === undefined ? textFont : fontFor(theme, /** @type {import("../../theme/Theme.js").FontSize} */ (m.text), "bold"), colorKey: "accent" });
      }
      context.font = textFont;
      for (const text of wrapText(measure, block.text, width - indent)) {
        lines.push({ text, x: indent, y, width: width - indent, height: textHeight, font: textFont, colorKey: "text" });
        y += textHeight;
      }
      y += m.blockGap;
    });
    return { lines, height: Math.ceil(y) };
  }
}

/** Paints the laid-out lines that show through the article's window. */
class ArticleLines extends UiNode {
  /** @type {() => readonly ArticleLine[]} */
  #lines;
  /** @type {() => { y: number, height: number }} */
  #visibleArea;

  /**
   * @param {() => readonly ArticleLine[]} lines
   * @param {() => { y: number, height: number }} visibleArea the article's bounds: lines outside them are not painted
   */
  constructor(lines, visibleArea) {
    super();
    this.#lines = lines;
    this.#visibleArea = visibleArea;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const shown = this.#visibleArea();
    for (const line of this.#lines()) {
      const top = area.y + line.y;
      if (top + line.height < shown.y || top > shown.y + shown.height) {
        continue;
      }
      const color = theme.colors[line.colorKey] ?? theme.colors.text;
      drawTextInRect(context, line.text, { x: area.x + line.x, y: top, width: line.width, height: line.height }, { font: line.font, color, align: "left" });
    }
  }
}
