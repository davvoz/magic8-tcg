import { SoundCue } from "../../application/audio/SoundCue.js";
import { drawAvatar } from "./avatar.js";
import { Button } from "./Button.js";
import { bevelRoundedRect, drawTextInRect, fillRoundedRect, glowRoundedRect, roundedRectPath, verticalGradient } from "./drawing.js";
import { drawCheckIcon } from "./shapes.js";
import { ellipsize } from "../text/textUtils.js";
import { shade, withAlpha } from "../theme/color.js";
import { displayFont, fontFor } from "../theme/Theme.js";

const PADDING = 16;
const STRIPE_WIDTH = 12;
const CHECK_SIZE = 22;
const TITLE_SIZE = 22;
const GLOW_BLUR = 18;
/** The portrait of a player's row, as a share of the row's height. */
const AVATAR_RADIUS = 0.36;
/** How far apart several portraits stand, in radii (less than 2: each overlaps the one before). */
const AVATAR_STEP = 1.45;

/**
 * One colour of a row's stripe and its share of the stripe's height.
 * @typedef {Readonly<{ color: string, weight: number }>} StripeBand
 */

/**
 * A selectable list row: a coloured stripe on the left (a deck's faction
 * mix, one band per faction in proportion to its cards, or a category), a title in the display face, a muted subtitle and
 * a check mark when selected. A row about a player shows their portrait
 * (`avatar`: the account) after the stripe; a row about several (a game
 * between two) shows each, overlapping. Behaves exactly like a Button
 * (`text` stays the title for keyboard users and tests); `selected` drives
 * the look.
 */
export class OptionRow extends Button {
  /** @type {string} */
  subtitle;
  /** The stripe's bands, top to bottom; empty for no stripe. @type {readonly StripeBand[]} */
  stripe;
  /** @type {boolean} */
  selected;
  /** The account (or accounts, left to right) whose portrait the row shows, or null for none. @type {string | readonly string[] | null} */
  avatar;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, enabled?: boolean, text: string, subtitle?: string, stripe?: readonly StripeBand[], selected?: boolean, avatar?: string | readonly string[] | null, onActivate: () => void }} options
   */
  constructor(options) {
    super({ ...options, variant: "secondary", align: "left" });
    this.subtitle = options.subtitle ?? "";
    this.stripe = options.stripe ?? [];
    this.selected = options.selected ?? false;
    this.avatar = options.avatar ?? null;
    this.activationCue = SoundCue.UI_SELECT;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const { colors } = theme;
    const radius = theme.spacing.radius;
    const enabled = this.isEffectivelyEnabled;
    if (this.selected || this.focused) {
      glowRoundedRect(context, area, { color: this.focused ? colors.focus : withAlpha(colors.accent, 0.8), radius, blur: GLOW_BLUR, lineWidth: 2 });
    }
    fillRoundedRect(context, area, { fill: this.#slabGradient(context, theme, enabled), stroke: this.#rimColor(theme), radius, lineWidth: this.focused ? 3 : 1.5 });
    if (enabled) {
      bevelRoundedRect(context, area, { light: withAlpha("#ffffff", 0.14), dark: withAlpha("#000000", 0.45), radius });
    }
    this.#paintStripe(context, theme);
    const portrait = area.height * AVATAR_RADIUS;
    this.#accounts().forEach((account, index) => {
      drawAvatar(context, theme, { account, center: { x: this.#contentLeft() + portrait * (1 + index * AVATAR_STEP), y: area.y + area.height / 2 }, radius: portrait });
    });
    this.#paintTexts(context, theme, enabled);
    if (this.selected) {
      drawCheckIcon(context, { x: area.x + area.width - PADDING - CHECK_SIZE / 2, y: area.y + area.height / 2 }, CHECK_SIZE, { color: colors.accentLight });
    }
  }

  /**
   * The slab's gradient: gold-tinted when selected, lifted under the pointer, sunk when disabled.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {boolean} enabled
   */
  #slabGradient(context, theme, enabled) {
    const { colors } = theme;
    const base = this.selected ? shade(colors.accentDark, -0.35) : colors.panelLight;
    const lift = this.hovered && enabled && !this.pressed ? 0.1 : 0;
    const top = enabled ? 0.12 : -0.2;
    const bottom = enabled ? -0.25 : -0.45;
    return verticalGradient(context, this.bounds, [[0, shade(base, top + lift)], [1, shade(base, bottom + lift)]]);
  }

  /**
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {boolean} enabled
   */
  #titleColor(theme, enabled) {
    if (!enabled) {
      return theme.colors.disabledText;
    }
    return this.selected ? theme.colors.accentLight : theme.colors.text;
  }

  /** @param {import("../theme/Theme.js").Theme} theme */
  #rimColor(theme) {
    if (this.focused) {
      return theme.colors.focus;
    }
    return this.selected ? theme.colors.accent : theme.colors.panelBorder;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  #paintStripe(context, theme) {
    const total = this.stripe.reduce((sum, band) => sum + Math.max(0, band.weight), 0);
    if (total <= 0) {
      return;
    }
    const area = this.bounds;
    const radius = theme.spacing.radius;
    context.save();
    roundedRectPath(context, area, radius);
    context.clip();
    let y = area.y;
    for (const band of this.stripe) {
      const height = (area.height * Math.max(0, band.weight)) / total;
      if (height > 0) {
        // Each band keeps the row's light: lit at the top of the row, shaded at the bottom.
        context.fillStyle = verticalGradient(context, area, [[0, shade(band.color, 0.2)], [1, shade(band.color, -0.3)]]);
        context.fillRect(area.x, y, STRIPE_WIDTH, height);
      }
      y += height;
    }
    context.restore();
  }

  /** Where the row's content starts, past the stripe. */
  #contentLeft() {
    return this.bounds.x + PADDING + (this.stripe.length === 0 ? 0 : STRIPE_WIDTH);
  }

  /** @returns {readonly string[]} the accounts whose portraits the row shows */
  #accounts() {
    if (this.avatar === null) {
      return [];
    }
    return typeof this.avatar === "string" ? [this.avatar] : this.avatar;
  }

  /** How much room the portraits take before the texts. */
  #portraitsWidth() {
    const count = this.#accounts().length;
    return count === 0 ? 0 : this.bounds.height * AVATAR_RADIUS * (2 + (count - 1) * AVATAR_STEP) + PADDING * 0.75;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {boolean} enabled
   */
  #paintTexts(context, theme, enabled) {
    const area = this.bounds;
    const { colors } = theme;
    const left = this.#contentLeft() + this.#portraitsWidth();
    const width = area.width - (left - area.x) - PADDING - (this.selected ? CHECK_SIZE + PADDING : 0);
    const hasSubtitle = this.subtitle.length > 0;
    const titleHeight = hasSubtitle ? area.height * 0.55 : area.height;
    const titleFont = displayFont(theme, TITLE_SIZE);
    context.font = titleFont;
    const title = ellipsize((candidate) => context.measureText(candidate).width, this.text, width);
    drawTextInRect(context, title, { x: left, y: area.y, width, height: titleHeight }, { font: titleFont, color: this.#titleColor(theme, enabled), align: "left" });
    if (!hasSubtitle) {
      return;
    }
    const subtitleFont = fontFor(theme, "small");
    context.font = subtitleFont;
    const subtitle = ellipsize((candidate) => context.measureText(candidate).width, this.subtitle, width);
    drawTextInRect(context, subtitle, { x: left, y: area.y + titleHeight - 4, width, height: area.height - titleHeight }, { font: subtitleFont, color: enabled ? colors.textMuted : colors.disabledText, align: "left" });
  }
}
