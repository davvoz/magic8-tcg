import { Button } from "./Button.js";
import { bevelRoundedRect, drawTextInRect, fillRoundedRect, glowRoundedRect, roundedRectPath, verticalGradient } from "./drawing.js";
import { drawCheckIcon } from "./shapes.js";
import { ellipsize } from "../text/textUtils.js";
import { shade, withAlpha } from "../theme/color.js";
import { displayFont, fontFor } from "../theme/Theme.js";

const PADDING = 16;
const STRIPE_WIDTH = 8;
const CHECK_SIZE = 22;
const TITLE_SIZE = 22;
const GLOW_BLUR = 18;

/**
 * A selectable list row: a coloured stripe on the left (the option's
 * faction or category), a title in the display face, a muted subtitle and
 * a check mark when selected. Behaves exactly like a Button (`text` stays
 * the title for keyboard users and tests); `selected` drives the look.
 */
export class OptionRow extends Button {
  /** @type {string} */
  subtitle;
  /** Hex colour of the stripe, or null for none. @type {string | null} */
  stripeColor;
  /** @type {boolean} */
  selected;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, enabled?: boolean, text: string, subtitle?: string, stripeColor?: string | null, selected?: boolean, onActivate: () => void }} options
   */
  constructor(options) {
    super({ ...options, variant: "secondary", align: "left" });
    this.subtitle = options.subtitle ?? "";
    this.stripeColor = options.stripeColor ?? null;
    this.selected = options.selected ?? false;
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
    if (this.stripeColor === null) {
      return;
    }
    const area = this.bounds;
    const radius = theme.spacing.radius;
    context.save();
    roundedRectPath(context, area, radius);
    context.clip();
    context.fillStyle = verticalGradient(context, area, [[0, shade(this.stripeColor, 0.2)], [1, shade(this.stripeColor, -0.3)]]);
    context.fillRect(area.x, area.y, STRIPE_WIDTH, area.height);
    context.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {boolean} enabled
   */
  #paintTexts(context, theme, enabled) {
    const area = this.bounds;
    const { colors } = theme;
    const left = area.x + PADDING + (this.stripeColor === null ? 0 : STRIPE_WIDTH);
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
