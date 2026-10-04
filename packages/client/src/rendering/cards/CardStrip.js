/**
 * A card as a one-line strip for lists (deck builder, collection, shop,
 * market, trades): faction stripe, cost gem, name in the display face, rarity
 * (in its colour, when known), type and keywords, the copy count (or any
 * short `badge`, e.g. a copy's serial) and, for creatures, attack and health
 * gems. A `fresh` card (just received) is lit and tagged "NEW"; a `selected`
 * one is rimmed in gold and checked; a `lifted` one (under the pointer) is
 * brighter. Decorative only: the row's buttons sit beside it, or a
 * CardOption makes the strip itself the button. On a strip too narrow to
 * leave the name room (a phone's column) the stats, then the badge, are
 * written in the second line instead of drawn beside the name.
 */
import { CardType } from "@magic8/engine/domain/cards/CardType.js";
import { shade, withAlpha } from "../theme/color.js";
import { rarityColor, rarityLabel } from "../theme/rarity.js";
import { displayFont, factionTones, fontFor } from "../theme/Theme.js";
import { drawTextInRect, fillRoundedRect, glowRoundedRect, roundedRectPath, verticalGradient } from "../ui/drawing.js";
import { drawCheckIcon } from "../ui/shapes.js";
import { capitalize, ellipsize } from "../text/textUtils.js";
import { UiNode } from "../ui/UiNode.js";
import { drawCostGem, drawStatGem } from "./statGem.js";

const STRIPE_WIDTH = 6;
const PADDING = 10;
const COST_RADIUS = 15;
const STAT_RADIUS = 13;
const STAT_GAP = 8;
const COUNT_WIDTH = 44;
/** Room around a badge's text. */
const BADGE_PADDING = 16;
const NAME_SIZE = 19;
const FRESH = Object.freeze({ label: "NEW", width: 50, blur: 14 });
/** The gold check of a chosen card, and its halo. */
const CHECK = Object.freeze({ radius: 12, blur: 16 });
/** How much brighter a strip under the pointer is. */
const LIFT = 0.18;
/** Below this much room for the name, the stat gems give theirs up. */
const MIN_NAME_ROOM = 110;

/**
 * @typedef {Readonly<{ name: string, type: string, faction: string, cost: number, attack: number, health: number, keywords?: readonly string[] }>} StripCard
 */

export class CardStrip extends UiNode {
  /** @type {StripCard} */
  card;
  /** Copies in the deck; null hides the count badge. @type {number | null} */
  count;
  /** The badge's text in place of the copy count (e.g. "#7"); null for the count. @type {string | null} */
  badge;
  /** Drawn dimmed (a card not yet in the deck). */
  muted;
  /** Drawn in the danger colour (an unknown card id). */
  broken;
  /** The card's rarity, when known. @type {string | null} */
  rarity;
  /** Just received: lit and tagged "NEW". */
  fresh;
  /** Chosen: rimmed in gold and checked. */
  selected;
  /** Under the pointer: drawn brighter. */
  lifted = false;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, card: StripCard, count?: number | null, badge?: string | null, muted?: boolean, broken?: boolean, rarity?: string | null, fresh?: boolean, selected?: boolean }} options
   */
  constructor(options) {
    super(options);
    this.card = options.card;
    this.count = options.count ?? null;
    this.badge = options.badge ?? null;
    this.muted = options.muted ?? false;
    this.broken = options.broken ?? false;
    this.rarity = options.rarity ?? null;
    this.fresh = options.fresh ?? false;
    this.selected = options.selected ?? false;
    this.passthrough = true;
  }

  /** The badge's text: the explicit badge, else the copy count; null for none. */
  get badgeText() {
    if (this.badge !== null) {
      return this.badge;
    }
    return this.count !== null && this.count > 0 ? `x${this.count}` : null;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const tones = factionTones(theme, this.card.faction);
    const radius = theme.spacing.radius;
    const ring = this.#ringColor(theme);
    context.save();
    if (ring !== null) {
      glowRoundedRect(context, area, { color: ring, radius, blur: this.selected ? CHECK.blur : FRESH.blur, lineWidth: 2 });
    }
    if (this.muted) {
      context.globalAlpha = 0.55 * context.globalAlpha;
    }
    const lift = this.lifted ? LIFT : 0;
    fillRoundedRect(context, area, { fill: verticalGradient(context, area, [[0, withAlpha(shade(tones.dark, lift), 0.85)], [1, withAlpha(shade(tones.dark, lift - 0.4), 0.95)]]), stroke: ring ?? withAlpha(tones.base, this.lifted ? 0.85 : 0.5), radius, lineWidth: ring === null ? 1 : 2 });
    context.save();
    roundedRectPath(context, area, radius);
    context.clip();
    context.fillStyle = tones.base;
    context.fillRect(area.x, area.y, STRIPE_WIDTH, area.height);
    context.restore();
    this.#paintCost(context, theme, area);
    const nameX = area.x + STRIPE_WIDTH + PADDING + COST_RADIUS * 2 + PADDING;
    const badgeWidth = this.#badgeWidth(context, theme);
    const room = this.#roomFor(area, nameX, badgeWidth);
    const right = this.#paintRightSide(context, theme, area, { ...room, badgeWidth });
    this.#paintName(context, theme, { x: nameX, right, statsInText: !room.gems && this.card.type === CardType.CREATURE, badgeInText: !room.badge && badgeWidth > 0 });
    context.restore();
  }

  /**
   * The rim of a chosen card (gold) or of one just received (green); null for the faction's own.
   * @param {import("../theme/Theme.js").Theme} theme
   */
  #ringColor(theme) {
    if (this.selected) {
      return theme.colors.accent;
    }
    return this.fresh ? theme.colors.success : null;
  }

  /**
   * How wide the badge is: room for its text, never narrower than a count's; 0 for no badge.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  #badgeWidth(context, theme) {
    const text = this.badgeText;
    if (text === null) {
      return 0;
    }
    context.font = fontFor(theme, "small", "bold");
    return Math.max(COUNT_WIDTH, Math.ceil(context.measureText(text).width) + BADGE_PADDING);
  }

  /**
   * What fits beside the name and still leaves it room: the stat gems give theirs up first, then the badge.
   * @param {import("@magic8/engine/shared/geometry.js").Rect} area
   * @param {number} nameX where the name starts
   * @param {number} badgeWidth 0 for no badge
   * @returns {{ gems: boolean, badge: boolean }}
   */
  #roomFor(area, nameX, badgeWidth) {
    const gems = this.card.type === CardType.CREATURE ? STAT_RADIUS * 4 + 2 * STAT_GAP : 0;
    const badge = badgeWidth > 0 ? badgeWidth + STAT_GAP : 0;
    // The NEW tag of a fresh card and the check of a chosen one always show: the others make room around them.
    const free = area.x + area.width - PADDING - nameX - (this.fresh ? FRESH.width + STAT_GAP : 0) - (this.selected ? CHECK.radius * 2 + STAT_GAP : 0);
    if (free - gems - badge >= MIN_NAME_ROOM) {
      return { gems: true, badge: true };
    }
    return { gems: false, badge: free - badge >= MIN_NAME_ROOM };
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
   * Check, stat gems, badge and NEW tag, right-aligned; returns the x where they start.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {import("@magic8/engine/shared/geometry.js").Rect} area
   * @param {{ gems: boolean, badge: boolean, badgeWidth: number }} room whether the stats are drawn as gems, and the badge (this wide) beside them
   */
  #paintRightSide(context, theme, area, { gems, badge, badgeWidth }) {
    const centerY = area.y + area.height / 2;
    let x = area.x + area.width - PADDING;
    if (this.selected) {
      x -= CHECK.radius;
      this.#paintCheck(context, theme, { x, y: centerY });
      x -= CHECK.radius + STAT_GAP;
    }
    if (gems && this.card.type === CardType.CREATURE) {
      x -= STAT_RADIUS;
      drawStatGem(context, theme, { center: { x, y: centerY }, radius: STAT_RADIUS, value: this.card.health, color: theme.colors.health, icon: "shield" });
      x -= STAT_RADIUS * 2 + STAT_GAP;
      drawStatGem(context, theme, { center: { x, y: centerY }, radius: STAT_RADIUS, value: this.card.attack, color: theme.colors.attack, icon: "sword" });
      x -= STAT_RADIUS + STAT_GAP;
    }
    const text = this.badgeText;
    if (badge && text !== null) {
      x -= badgeWidth;
      const box = { x, y: centerY - 12, width: badgeWidth, height: 24 };
      fillRoundedRect(context, box, { fill: withAlpha(theme.colors.accent, 0.18), stroke: withAlpha(theme.colors.accent, 0.7), radius: 12, lineWidth: 1 });
      drawTextInRect(context, text, box, { font: fontFor(theme, "small", "bold"), color: theme.colors.accentLight });
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
   * A gold disc with a dark check.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {{ x: number, y: number }} center
   */
  #paintCheck(context, theme, center) {
    const box = { x: center.x - CHECK.radius, y: center.y - CHECK.radius, width: CHECK.radius * 2, height: CHECK.radius * 2 };
    context.beginPath();
    context.arc(center.x, center.y, CHECK.radius, 0, Math.PI * 2);
    context.fillStyle = verticalGradient(context, box, [[0, shade(theme.colors.accent, 0.3)], [1, shade(theme.colors.accent, -0.3)]]);
    context.fill();
    drawCheckIcon(context, center, CHECK.radius * 1.1, { color: theme.colors.panelDark });
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {{ x: number, right: number, statsInText: boolean, badgeInText: boolean }} span `statsInText`, `badgeInText`: attack and health, the badge lead the second line
   */
  #paintName(context, theme, { x, right, statsInText, badgeInText }) {
    const area = this.bounds;
    const width = Math.max(0, right - x);
    const nameFont = displayFont(theme, NAME_SIZE);
    context.font = nameFont;
    const name = ellipsize((text) => context.measureText(text).width, this.card.name, width);
    drawTextInRect(context, name, { x, y: area.y, width, height: area.height * 0.58 }, { font: nameFont, color: this.broken ? theme.colors.danger : theme.colors.accentLight, align: "left" });
    const keywords = (this.card.keywords ?? []).join(" · ");
    const kind = keywords.length === 0 ? capitalize(this.card.type) : `${capitalize(this.card.type)} · ${keywords}`;
    const lead = [...(badgeInText ? [this.badgeText] : []), ...(statsInText ? [`${this.card.attack}/${this.card.health}`] : [])];
    const subtitle = [...lead, kind].join(" · ");
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
