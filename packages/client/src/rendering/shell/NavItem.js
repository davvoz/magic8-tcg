/**
 * One section on the rail: its icon over its name. The section on show is
 * lit (a raised plate, gold rim and letters); the pointer lifts the others.
 * A locked section stays where it is, dimmed, its lock beside the icon:
 * activating it tells the player why (`onActivate` decides what happens).
 */
import { SoundCue } from "../../application/audio/SoundCue.js";
import { drawTextInRect, fillRoundedRect, glowRoundedRect, verticalGradient } from "../ui/drawing.js";
import { UiNode } from "../ui/UiNode.js";
import { fitText } from "../text/textUtils.js";
import { shade, withAlpha } from "../theme/color.js";
import { scalableFont } from "../theme/Theme.js";
import { Icon, drawIcon } from "../ui/icons.js";

/** The icon's share of the item's height, where its label starts, and the lock's size beside a locked icon. */
const ICON = Object.freeze({ share: 0.36, top: 0.14, labelTop: 0.58, lock: 0.42 });
const GLOW_BLUR = 14;

export class NavItem extends UiNode {
  label;
  icon;
  /** The section on show. */
  selected;
  /** Nothing to open here yet: dimmed, with a lock. */
  locked;
  /** @type {() => void} */
  onActivate;

  /**
   * @param {{ id: string, x: number, y: number, width: number, height: number, label: string, icon: string, selected?: boolean, locked?: boolean, onActivate: () => void }} options
   */
  constructor(options) {
    super(options);
    this.label = options.label;
    this.icon = options.icon;
    this.selected = options.selected ?? false;
    this.locked = options.locked ?? false;
    this.onActivate = options.onActivate;
    this.interactive = true;
    this.focusable = true;
    this.activationCue = SoundCue.UI_CLICK;
  }

  activate() {
    if (this.isEffectivelyEnabled && this.isEffectivelyVisible) {
      this.onActivate();
    }
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const area = this.bounds;
    const { colors } = theme;
    const radius = theme.spacing.radius;
    if (this.selected) {
      glowRoundedRect(context, area, { color: withAlpha(colors.accent, 0.45), radius, blur: GLOW_BLUR, lineWidth: 1.5 });
      fillRoundedRect(context, area, { fill: verticalGradient(context, area, [[0, shade(colors.panelLight, 0.12)], [1, colors.panel]]), stroke: colors.accent, radius, lineWidth: 1.5 });
    } else if (this.hovered || this.pressed) {
      fillRoundedRect(context, area, { fill: withAlpha(colors.panelLight, this.pressed ? 0.9 : 0.6), radius });
    }
    if (this.focused) {
      fillRoundedRect(context, area, { stroke: colors.focus, radius, lineWidth: 3 });
    }
    const color = this.#color(theme);
    const size = Math.round(area.height * ICON.share);
    const iconX = area.x + (area.width - size) / 2;
    drawIcon(context, this.icon, { x: iconX, y: area.y + area.height * ICON.top, size, color });
    if (this.locked) {
      const lock = Math.round(size * ICON.lock);
      drawIcon(context, Icon.LOCK, { x: iconX + size - lock / 3, y: area.y + area.height * ICON.top - lock / 4, size: lock, color: colors.textMuted });
    }
    const labelArea = { x: area.x, y: area.y + area.height * ICON.labelTop, width: area.width, height: area.height * (1 - ICON.labelTop) - 4 };
    const fitted = fitText(context, { text: this.label, font: scalableFont(theme, "small", this.selected ? "bold" : "normal"), size: theme.fonts.sizes.small, width: labelArea.width - 4, minScale: 0.7 });
    drawTextInRect(context, fitted.text, labelArea, { font: fitted.font, color, align: "center" });
  }

  /** @param {import("../theme/Theme.js").Theme} theme */
  #color(theme) {
    const { colors } = theme;
    if (this.locked) {
      return colors.disabledText;
    }
    if (this.selected) {
      return colors.accentLight;
    }
    return this.hovered ? colors.text : colors.textMuted;
  }
}
