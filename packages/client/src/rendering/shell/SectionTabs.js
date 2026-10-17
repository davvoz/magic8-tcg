/**
 * A section's own screens as tabs in the top bar (Decks: My decks and
 * Collection; Market: Shop, Player market and Trades), side by side on one
 * plate, the one on show lit. A tab that cannot be opened stays in its
 * place, dimmed, with a lock before its name: activating it tells the
 * player why (`onOpen` decides).
 */
import { SoundCue } from "../../application/audio/SoundCue.js";
import { drawTextInRect, fillRoundedRect, verticalGradient } from "../ui/drawing.js";
import { UiNode } from "../ui/UiNode.js";
import { fitText } from "../text/textUtils.js";
import { shade, withAlpha } from "../theme/color.js";
import { scalableFont } from "../theme/Theme.js";
import { Icon, drawIcon } from "../ui/icons.js";

/** Each tab's width, wide and compact (a phone, where tabs take their short names), the room between them, and the plate's beyond them at its ends. */
export const TAB = Object.freeze({ wide: 190, compact: 104, gap: 4, pad: 3 });
/** The lock's share of the tab's height, and the room after it. */
const LOCK = Object.freeze({ share: 0.4, gap: 6 });

/**
 * How wide a row of `count` tabs is.
 * @param {number} count
 * @param {boolean} compact
 */
export function tabsWidth(count, compact) {
  if (count === 0) {
    return 0;
  }
  return count * (compact ? TAB.compact : TAB.wide) + (count - 1) * TAB.gap + 2 * TAB.pad;
}

export class SectionTabs extends UiNode {
  /**
   * @param {{
   *   x: number, y: number, height: number, compact: boolean,
   *   tabs: readonly import("./sections.js").TabEntry[], current: string, onOpen: (tab: import("./sections.js").TabEntry) => void,
   * }} options `current`: the scene on show
   */
  constructor({ x, y, height, compact, tabs, current, onOpen }) {
    super({ id: "shell.tabs", x, y, width: tabsWidth(tabs.length, compact), height });
    const width = compact ? TAB.compact : TAB.wide;
    tabs.forEach((tab, index) => {
      this.add(
        new TabItem({
          id: `shell.tab.${tab.scene}`,
          x: TAB.pad + index * (width + TAB.gap),
          y: 0,
          width,
          height,
          label: compact ? tab.short : tab.label,
          selected: tab.scene === current,
          locked: tab.locked !== null,
          onActivate: () => onOpen(tab),
        }),
      );
    });
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    fillRoundedRect(context, this.bounds, { fill: withAlpha(theme.colors.panelDark, 0.7), stroke: withAlpha(theme.colors.accent, 0.22), radius: theme.spacing.radius, lineWidth: 1 });
  }
}

/** One tab: its name, lit when on show, dimmed with a lock when it cannot be opened. */
export class TabItem extends UiNode {
  label;
  selected;
  locked;
  /** @type {() => void} */
  onActivate;

  /**
   * @param {{ id: string, x: number, y: number, width: number, height: number, label: string, selected: boolean, locked: boolean, onActivate: () => void }} options
   */
  constructor({ label, selected, locked, onActivate, ...frame }) {
    super(frame);
    this.label = label;
    this.selected = selected;
    this.locked = locked;
    this.onActivate = onActivate;
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
    const radius = Math.max(2, theme.spacing.radius - 2);
    if (this.selected) {
      fillRoundedRect(context, area, { fill: verticalGradient(context, area, [[0, shade(colors.panelLight, 0.14)], [1, colors.panel]]), stroke: colors.accent, radius, lineWidth: 1.5 });
    } else if (this.hovered || this.pressed) {
      fillRoundedRect(context, area, { fill: withAlpha(colors.panelLight, this.pressed ? 0.9 : 0.6), radius });
    }
    if (this.focused) {
      fillRoundedRect(context, area, { stroke: colors.focus, radius, lineWidth: 3 });
    }
    const color = this.#color(theme);
    const font = scalableFont(theme, "small", this.selected ? "bold" : "normal");
    const lock = this.locked ? Math.round(area.height * LOCK.share) : 0;
    const room = area.width - 12 - (lock > 0 ? lock + LOCK.gap : 0);
    const fitted = fitText(context, { text: this.label, font, size: theme.fonts.sizes.small, width: room, minScale: 0.7 });
    if (lock === 0) {
      drawTextInRect(context, fitted.text, area, { font: fitted.font, color, align: "center" });
      return;
    }
    context.font = fitted.font;
    const textWidth = context.measureText(fitted.text).width;
    const startX = area.x + Math.max(6, (area.width - lock - LOCK.gap - textWidth) / 2);
    drawIcon(context, Icon.LOCK, { x: startX, y: area.y + (area.height - lock) / 2, size: lock, color });
    drawTextInRect(context, fitted.text, { x: startX + lock + LOCK.gap, y: area.y, width: textWidth + 1, height: area.height }, { font: fitted.font, color, align: "left" });
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
    return this.hovered || this.focused ? colors.text : colors.textMuted;
  }
}
