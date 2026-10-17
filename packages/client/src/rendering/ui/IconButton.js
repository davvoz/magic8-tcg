/**
 * A button that shows an icon (icons.js), alone or before a
 * short caption, on the same slab or plate as every other button; `badge`
 * puts a count in a red dot on its top-right corner (unread notifications).
 * Its `text` stays empty: the caption is drawn beside the icon instead,
 * the two centred between the plate's ornate ends (never on them).
 */
import { drawIcon } from "./icons.js";
import { drawTextInRect } from "./drawing.js";
import { Button } from "./Button.js";
import { fitText } from "../text/textUtils.js";
import { scalableFont } from "../theme/Theme.js";

/** The icon's share of the button's height, the room between it and the caption, and the badge's size (a share of the height). */
const ICON = Object.freeze({ share: 0.5, gap: 8, badge: 0.46 });

export class IconButton extends Button {
  icon;
  caption;
  /** The count in the red dot, or null for none. @type {string | null} */
  badge;

  /**
   * @param {Omit<ConstructorParameters<typeof Button>[0], "text"> & { icon: string, caption?: string, badge?: string | null }} options
   */
  constructor({ icon, caption = "", badge = null, ...options }) {
    // A plate too narrow for the icon and the caption draws its ends narrower rather than under them (an icon alone
    // on a square keeps the plain slab).
    super({ keepPlate: caption !== "", ...options, text: "" });
    this.icon = icon;
    this.caption = caption;
    this.badge = badge;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    super.paint(context, theme);
    const area = this.bounds;
    const { colors } = theme;
    const color = this.#color(theme);
    const size = Math.round(area.height * ICON.share);
    const iconY = area.y + (area.height - size) / 2;
    if (this.caption.length === 0) {
      drawIcon(context, this.icon, { x: area.x + (area.width - size) / 2, y: iconY, size, color });
    } else {
      const padding = this.contentPadding(context, theme);
      const room = Math.max(0, area.width - 2 * padding);
      const fitted = fitText(context, { text: this.caption, font: scalableFont(theme, "small", "bold"), size: theme.fonts.sizes.small, width: room - size - ICON.gap, minScale: theme.textFit?.minScale ?? 1 });
      context.font = fitted.font;
      const textWidth = context.measureText(fitted.text).width;
      const startX = area.x + padding + Math.max(0, (room - size - ICON.gap - textWidth) / 2);
      drawIcon(context, this.icon, { x: startX, y: iconY, size, color });
      drawTextInRect(context, fitted.text, { x: startX + size + ICON.gap, y: area.y, width: textWidth + 1, height: area.height }, { font: fitted.font, color, align: "left" });
    }
    if (this.badge !== null) {
      const radius = (area.height * ICON.badge) / 2;
      const center = { x: area.x + area.width - radius * 0.6, y: area.y + radius * 0.6 };
      context.save();
      context.fillStyle = colors.danger;
      context.beginPath();
      context.arc(center.x, center.y, radius, 0, 2 * Math.PI);
      context.fill();
      context.restore();
      const badgeFont = scalableFont(theme, "tiny", "bold");
      drawTextInRect(context, this.badge, { x: center.x - radius * 1.4, y: center.y - radius, width: radius * 2.8, height: radius * 2 }, { font: badgeFont(Math.round(radius * 1.15)), color: colors.text, align: "center" });
    }
  }

  /**
   * The icon and the caption, side by side: what the plate makes room for.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  labelWidth(context, theme) {
    const icon = Math.round(this.height * ICON.share);
    if (this.caption.length === 0) {
      return icon;
    }
    context.font = scalableFont(theme, "small", "bold")(theme.fonts.sizes.small);
    return icon + ICON.gap + context.measureText(this.caption).width;
  }

  /** @param {import("../theme/Theme.js").Theme} theme */
  #color(theme) {
    if (!this.isEffectivelyEnabled) {
      return theme.colors.disabledText;
    }
    if (this.variant === "primary") {
      return theme.colors.accentText;
    }
    return this.hovered || this.focused ? theme.colors.accentLight : theme.colors.text;
  }
}
