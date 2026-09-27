/**
 * A product's cards as a small fanned stack (the cart): up to three faces
 * (a single, a deck's rarest cards) or card backs (packs: unknown until
 * opened), with a count badge. Decorative.
 */
import { CARD_SIZE } from "../board/BoardLayout.js";
import { fontFor } from "../theme/Theme.js";
import { withAlpha } from "../theme/color.js";
import { drawTextInRect, fillRoundedRect } from "../ui/drawing.js";
import { UiNode } from "../ui/UiNode.js";
import { drawCard, drawCardBack } from "./CardRenderer.js";

const ASPECT = CARD_SIZE.battlefield.height / CARD_SIZE.battlefield.width;
/** At most this many cards; each is turned `radians` from the next and shifted by `shift` of a card's width. */
const FAN = Object.freeze({ max: 3, radians: 0.16, shift: 0.42, fill: 0.86 });
const BADGE = Object.freeze({ height: 30, minWidth: 46, padding: 10 });

/**
 * @typedef {Readonly<{ card: import("./CardFace.js").CardFaceModel, rarity: string | null }>} FanCard
 */

export class CardFan extends UiNode {
  /** @type {readonly FanCard[]} */
  cards;
  /** Card backs drawn when there are no faces. */
  backs;
  /** e.g. "×3"; nothing when empty. */
  badge;

  /**
   * @param {{ id?: string, x?: number, y?: number, width: number, height: number, cards?: readonly FanCard[], backs?: number, badge?: string }} options
   */
  constructor(options) {
    super(options);
    this.cards = Object.freeze((options.cards ?? []).slice(0, FAN.max));
    this.backs = Math.min(options.backs ?? 0, FAN.max);
    this.badge = options.badge ?? "";
    this.passthrough = true;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const count = this.cards.length > 0 ? this.cards.length : this.backs;
    if (count > 0) {
      this.#paintFan(context, theme, area, count);
    }
    if (this.badge.length > 0) {
      this.#paintBadge(context, theme, area);
    }
  }

  /**
   * Cards turned around their bottom centre, the last one on top.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {{ x: number, y: number, width: number, height: number }} area
   * @param {number} count
   */
  #paintFan(context, theme, area, count) {
    const spread = 1 + (count - 1) * FAN.shift;
    const height = Math.min(area.height * FAN.fill, (area.width * FAN.fill * ASPECT) / spread);
    const width = height / ASPECT;
    const bottom = area.y + (area.height + height) / 2;
    const middle = (count - 1) / 2;
    for (let index = 0; index < count; index += 1) {
      const card = { x: -width / 2, y: -height, width, height };
      context.save();
      context.translate(area.x + area.width / 2 + (index - middle) * width * FAN.shift, bottom);
      context.rotate((index - middle) * FAN.radians);
      context.shadowColor = withAlpha(theme.colors.letterbox, 0.7);
      context.shadowBlur = 12;
      const face = this.cards[index];
      if (face === undefined) {
        drawCardBack(context, theme, card);
      } else {
        drawCard(context, theme, face.card, { ...card, alpha: context.globalAlpha, rarity: face.rarity });
      }
      context.restore();
    }
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {{ x: number, y: number, width: number, height: number }} area
   */
  #paintBadge(context, theme, area) {
    const font = fontFor(theme, "small", "bold");
    context.font = font;
    const width = Math.max(BADGE.minWidth, context.measureText(this.badge).width + 2 * BADGE.padding);
    const badge = { x: area.x + area.width - width, y: area.y + area.height - BADGE.height, width, height: BADGE.height };
    fillRoundedRect(context, badge, { fill: theme.colors.accent, stroke: theme.colors.accentLight, radius: BADGE.height / 2, lineWidth: 1.5 });
    drawTextInRect(context, this.badge, badge, { font, color: theme.colors.background });
  }
}
