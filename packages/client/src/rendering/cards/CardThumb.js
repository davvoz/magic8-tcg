/**
 * A card as a small thumbnail for lists of cards (trades, notifications):
 * the board's compact card face scaled to the node's width, with its
 * rarity and an optional caption underneath (serial, finish, copies
 * asked). Decorative, unless given `onActivate` (e.g. open the card's
 * details): then it can be clicked and focused like a button.
 */
import { CARD_SIZE } from "../board/BoardLayout.js";
import { fontFor } from "../theme/Theme.js";
import { withAlpha } from "../theme/color.js";
import { drawTextInRect, glowRoundedRect } from "../ui/drawing.js";
import { ellipsize } from "../text/textUtils.js";
import { UiNode } from "../ui/UiNode.js";
import { drawCard } from "./CardRenderer.js";

const CAPTION_HEIGHT = 22;
const ASPECT = CARD_SIZE.battlefield.height / CARD_SIZE.battlefield.width;

export class CardThumb extends UiNode {
  /** @type {import("./CardFace.js").CardFaceModel} */
  card;
  caption;
  /** Drawn in the accent colour (a foil copy). */
  highlight;
  /** The card's rarity, when known. @type {string | null} */
  rarity;
  /** @type {(() => void) | null} */
  onActivate;

  /**
   * Height of a thumbnail of the given width, caption included.
   * @param {number} width
   */
  static heightFor(width) {
    return Math.round(width * ASPECT) + CAPTION_HEIGHT;
  }

  /**
   * @param {{ id?: string, x?: number, y?: number, width: number, card: import("./CardFace.js").CardFaceModel, caption?: string, highlight?: boolean, rarity?: string | null, onActivate?: (() => void) | null }} options
   */
  constructor(options) {
    super({ ...options, height: CardThumb.heightFor(options.width) });
    this.card = options.card;
    this.caption = options.caption ?? "";
    this.highlight = options.highlight ?? false;
    this.rarity = options.rarity ?? null;
    this.onActivate = options.onActivate ?? null;
    const clickable = this.onActivate !== null;
    this.passthrough = !clickable;
    this.interactive = clickable;
    this.focusable = clickable;
  }

  activate() {
    if (this.onActivate !== null && this.isEffectivelyEnabled && this.isEffectivelyVisible) {
      this.onActivate();
    }
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const cardHeight = area.height - CAPTION_HEIGHT;
    const cardArea = { x: area.x, y: area.y, width: area.width, height: cardHeight };
    if (this.focused || this.hovered) {
      glowRoundedRect(context, cardArea, { color: withAlpha(this.focused ? theme.colors.focus : theme.colors.accentLight, 0.85), radius: area.width * 0.06, blur: 14, lineWidth: 2 });
    }
    drawCard(context, theme, this.card, { ...cardArea, alpha: context.globalAlpha, rarity: this.rarity });
    if (this.caption.length > 0) {
      const font = fontFor(theme, "tiny");
      context.font = font;
      const text = ellipsize((value) => context.measureText(value).width, this.caption, area.width);
      drawTextInRect(context, text, { x: area.x, y: area.y + cardHeight + 2, width: area.width, height: CAPTION_HEIGHT - 2 }, { font, color: this.highlight ? theme.colors.accentLight : theme.colors.textMuted });
    }
  }
}
