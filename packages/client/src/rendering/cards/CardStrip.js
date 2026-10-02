/**
 * A card as a one-line strip for lists (deck builder, collection, shop,
 * market): faction stripe, cost gem, name in the display face, rarity (in
 * its colour, when known), type and keywords, the copy count and, for
 * creatures, attack and health gems. A `fresh` card (just received) is lit
 * and tagged "NEW". Decorative only; the row's buttons sit beside it.
 */
import { CardType } from "@magic8/engine/domain/cards/CardType.js";
import { shade, withAlpha } from "../theme/color.js";
import { rarityColor, rarityLabel } from "../theme/rarity.js";
import { displayFont, factionTones, fontFor } from "../theme/Theme.js";
import { drawTextInRect, fillRoundedRect, glowRoundedRect, roundedRectPath, verticalGradient } from "../ui/drawing.js";
import { capitalize, ellipsize } from "../text/textUtils.js";
import { UiNode } from "../ui/UiNode.js";
import { drawCostGem, drawStatGem } from "./statGem.js";

const STRIPE_WIDTH = 6;
const PADDING = 10;
const COST_RADIUS = 15;
const STAT_RADIUS = 13;
const STAT_GAP = 8;
const COUNT_WIDTH = 44;
const NAME_SIZE = 19;
const FRESH = Object.freeze({ label: "NEW", width: 50, blur: 14 });

/**
 * @typedef {Readonly<{ name: string, type: string, faction: string, cost: number, attack: number, health: number, keywords?: readonly string[] }>} StripCard
 */

export class CardStrip extends UiNode {
  /** @type {StripCard} */
  card;
  /** Copies in the deck; null hides the count badge. @type {number | null} */
  count;
  /** Drawn dimmed (a card not yet in the deck). */
  muted;
  /** Drawn in the danger colour (an unknown card id). */
  broken;
  /** The card's rarity, when known. @type {string | null} */
  rarity;
  /** Just received: lit and tagged "NEW". */
  fresh;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, card: StripCard, count?: number | null, muted?: boolean, broken?: boolean, rarity?: string | null, fresh?: boolean }} options
   */
  constructor(options) {
    super(options);
    this.card = options.card;
    this.count = options.count ?? null;
    this.muted = options.muted ?? false;
    this.broken = options.broken ?? false;
    this.rarity = options.rarity ?? null;
    this.fresh = options.fresh ?? false;
    this.passthrough = true;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const tones = factionTones(theme, this.card.faction);
    const radius = theme.spacing.radius;
    context.save();
    if (this.fresh) {
      glowRoundedRect(context, area, { color: theme.colors.success, radius, blur: FRESH.blur, lineWidth: 2 });
    }
    if (this.muted) {
      context.globalAlpha = 0.55 * context.globalAlpha;
    }
    fillRoundedRect(context, area, { fill: verticalGradient(context, area, [[0, withAlpha(tones.dark, 0.85)], [1, withAlpha(shade(tones.dark, -0.4), 0.95)]]), stroke: this.fresh ? theme.colors.success : withAlpha(tones.base, 0.5), radius, lineWidth: this.fresh ? 2 : 1 });
    context.save();
    roundedRectPath(context, area, radius);
    context.clip();
    context.fillStyle = tones.base;
    context.fillRect(area.x, area.y, STRIPE_WIDTH, area.height);
    context.restore();
    this.#paintCost(context, theme, area);
    const right = this.#paintRightSide(context, theme, area);
    this.#paintName(context, theme, { x: area.x + STRIPE_WIDTH + PADDING + COST_RADIUS * 2 + PADDING, right });
    context.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {import("@magic8/engine/shared/geometry.js").Rect} area
   */
  #paintCost(context, theme, area) {
    const center = { x: area.x + STRIPE_WIDTH + PADDING + COST_RADIUS, y: area.y + area.height / 2 };
    drawCostGem(context, theme, { center, radius: COST_RADIUS, value: this.card.cost });
  }

  /**
   * Count badge and stat gems, right-aligned; returns the x where they start.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {import("@magic8/engine/shared/geometry.js").Rect} area
   */
  #paintRightSide(context, theme, area) {
    const centerY = area.y + area.height / 2;
    let x = area.x + area.width - PADDING;
    if (this.card.type === CardType.CREATURE) {
      x -= STAT_RADIUS;
      drawStatGem(context, theme, { center: { x, y: centerY }, radius: STAT_RADIUS, value: this.card.health, color: theme.colors.health, icon: "shield" });
      x -= STAT_RADIUS * 2 + STAT_GAP;
      drawStatGem(context, theme, { center: { x, y: centerY }, radius: STAT_RADIUS, value: this.card.attack, color: theme.colors.attack, icon: "sword" });
      x -= STAT_RADIUS + STAT_GAP;
    }
    if (this.count !== null && this.count > 0) {
      x -= COUNT_WIDTH;
      const badge = { x, y: centerY - 12, width: COUNT_WIDTH, height: 24 };
      fillRoundedRect(context, badge, { fill: withAlpha(theme.colors.accent, 0.18), stroke: withAlpha(theme.colors.accent, 0.7), radius: 12, lineWidth: 1 });
      drawTextInRect(context, `x${this.count}`, badge, { font: fontFor(theme, "small", "bold"), color: theme.colors.accentLight });
      x -= STAT_GAP;
    }
    if (this.fresh) {
      x -= FRESH.width;
      const tag = { x, y: centerY - 12, width: FRESH.width, height: 24 };
      fillRoundedRect(context, tag, { fill: withAlpha(theme.colors.success, 0.25), stroke: theme.colors.success, radius: 12, lineWidth: 1 });
      drawTextInRect(context, FRESH.label, tag, { font: fontFor(theme, "tiny", "bold"), color: theme.colors.success });
      x -= STAT_GAP;
    }
    return x;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {{ x: number, right: number }} span
   */
  #paintName(context, theme, { x, right }) {
    const area = this.bounds;
    const width = Math.max(0, right - x);
    const nameFont = displayFont(theme, NAME_SIZE);
    context.font = nameFont;
    const name = ellipsize((text) => context.measureText(text).width, this.card.name, width);
    drawTextInRect(context, name, { x, y: area.y, width, height: area.height * 0.58 }, { font: nameFont, color: this.broken ? theme.colors.danger : theme.colors.accentLight, align: "left" });
    const keywords = (this.card.keywords ?? []).join(" · ");
    const subtitle = keywords.length === 0 ? capitalize(this.card.type) : `${capitalize(this.card.type)} · ${keywords}`;
    const line = { x, y: area.y + area.height * 0.55, width, height: area.height * 0.4 };
    let offset = 0;
    if (this.rarity) {
      const font = fontFor(theme, "tiny", "bold");
      context.font = font;
      const label = `${rarityLabel(this.rarity)} · `;
      offset = Math.min(width, context.measureText(label).width);
      drawTextInRect(context, label, { ...line, width: offset }, { font, color: rarityColor(theme, this.rarity), align: "left" });
    }
    context.font = fontFor(theme, "tiny");
    drawTextInRect(context, ellipsize((text) => context.measureText(text).width, subtitle, width - offset), { ...line, x: x + offset, width: width - offset }, { font: fontFor(theme, "tiny"), color: theme.colors.textMuted, align: "left" });
  }
}
