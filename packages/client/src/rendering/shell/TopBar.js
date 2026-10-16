/**
 * The bar across the top of the screen: Back (when the screen has
 * somewhere to go back to) and the screen's title on the left — or, on a
 * screen of a section with tabs, the section's name (not on a phone) and
 * its tabs (SectionTabs) — and on the right the
 * player's things on the right — what their wallet holds, their ranked
 * entries, the notifications, the settings and their account (or Sign in).
 * Those on the right are laid from the right edge in; when the title would
 * be left too little room (a phone), the ones that matter least give way
 * first (`drop`).
 */
import { Icon } from "../ui/icons.js";
import { IconButton } from "../ui/IconButton.js";
import { Label } from "../ui/Label.js";
import { SectionTabs, tabsWidth } from "./SectionTabs.js";
import { UiNode } from "../ui/UiNode.js";
import { verticalGradient } from "../ui/drawing.js";
import { withAlpha } from "../theme/color.js";

/** The narrowest the title is left, and Back's width with its caption (a phone's Back is the arrow alone). */
const TITLE_MIN = Object.freeze({ wide: 240, compact: 120 });
const BACK_WIDTH = 132;
/** The section's name before its tabs (a phone shows the tabs alone). */
const TABS_TITLE = 170;

/**
 * Something on the right of the bar: its width, how readily it gives way
 * (the lowest `drop` first; Infinity never) and how to make it in the box it gets.
 * @typedef {Readonly<{ id: string, width: number, drop: number, make: (box: import("@magic8/engine/shared/geometry.js").Rect) => UiNode }>} BarControl
 * @typedef {Readonly<{ title: string, back: (() => void) | null }>} Heading the screen's title, and what its Back does (null: no Back)
 * @typedef {Readonly<{ title: string, entries: readonly import("./sections.js").TabEntry[], current: string, onOpen: (tab: import("./sections.js").TabEntry) => void }>} BarTabs
 *   a section's tabs: `title`, the section's name; `current`, the scene on show
 */

export class TopBar extends UiNode {
  /** @type {() => import("@magic8/engine/shared/geometry.js").Rect} */
  #screen;
  /** @type {IconButton | null} */
  #back = null;

  /**
   * @param {{
   *   layout: import("./ShellLayout.js").ShellLayout,
   *   origin: { x: number, y: number },
   *   screen: () => import("@magic8/engine/shared/geometry.js").Rect,
   *   heading: Heading,
   *   controls: readonly BarControl[],
   *   tabs?: BarTabs | null,
   * }} options `origin`: where the content starts (the bar is laid out above it); `screen`: the whole canvas, in the same coordinates;
   *   `tabs`: the section's tabs, in place of the title (null: none)
   */
  constructor({ layout, origin, screen, heading, controls, tabs = null }) {
    const { bar, controls: row, compact } = layout;
    super({ id: "shell.bar", x: bar.x - origin.x, y: bar.y - origin.y, width: bar.width, height: bar.height });
    this.#screen = screen;
    let left = row.padding;
    if (heading.back !== null) {
      const width = compact ? row.height : BACK_WIDTH;
      this.#back = this.add(new IconButton({ id: "shell.back", x: left, y: row.y, width, height: row.height, icon: Icon.BACK, caption: compact ? "" : "Back", onActivate: heading.back }));
      left += width + row.gap;
    }
    if (tabs !== null && tabs.entries.length > 0) {
      this.#buildTabs(tabs, { left, layout, controls });
      return;
    }
    const right = this.#placeControls(controls, { left: left + (compact ? TITLE_MIN.compact : TITLE_MIN.wide), right: bar.width - row.padding, row });
    this.add(this.#title(heading.title, { x: left, width: Math.max(0, right - row.gap - left), compact }));
  }

  /**
   * The section's name (not on a phone) and its tabs, then the controls in what they leave.
   * @param {BarTabs} tabs
   * @param {{ left: number, layout: import("./ShellLayout.js").ShellLayout, controls: readonly BarControl[] }} room
   */
  #buildTabs(tabs, { left, layout, controls }) {
    const { bar, controls: row, compact } = layout;
    let x = left;
    if (!compact) {
      this.add(this.#title(tabs.title, { x, width: TABS_TITLE, compact }));
      x += TABS_TITLE + row.gap;
    }
    this.#placeControls(controls, { left: x + tabsWidth(tabs.entries.length, compact) + row.gap, right: bar.width - row.padding, row });
    this.add(new SectionTabs({ x, y: row.y, height: row.height, compact, tabs: tabs.entries, current: tabs.current, onOpen: tabs.onOpen }));
  }

  /**
   * @param {string} text
   * @param {{ x: number, width: number, compact: boolean }} frame
   */
  #title(text, { x, width, compact }) {
    return new Label({ id: "shell.title", x, y: 0, width, height: this.height, text, size: compact ? "body" : "heading", weight: "bold", colorKey: "accentLight", align: "left", glow: true, fit: true });
  }

  /** The Back button, when the screen has one. */
  get backButton() {
    return this.#back;
  }

  /**
   * Lays the controls from the right edge in, after dropping those there is no room for.
   * @param {readonly BarControl[]} controls in order, left to right
   * @param {{ left: number, right: number, row: import("./ShellLayout.js").ShellLayout["controls"] }} room `left`: where they must stop
   * @returns {number} where the first of them starts (the right edge when there are none)
   */
  #placeControls(controls, { left, right, row }) {
    let kept = [...controls];
    const span = () => kept.reduce((total, control) => total + control.width, 0) + Math.max(0, kept.length - 1) * row.gap;
    while (kept.length > 0 && span() > right - left) {
      const weakest = kept.reduce((least, control) => (control.drop < least.drop ? control : least));
      if (!Number.isFinite(weakest.drop)) {
        break;
      }
      kept = kept.filter((control) => control !== weakest);
    }
    let x = right;
    for (const control of [...kept].reverse()) {
      x -= control.width;
      this.add(control.make({ x, y: row.y, width: control.width, height: row.height }));
      x -= row.gap;
    }
    return kept.length === 0 ? right : x + row.gap;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const { colors } = theme;
    const own = this.bounds;
    const screen = this.#screen();
    // From the rail to the screen's right edge, and up to its top one.
    const top = Math.min(screen.y, own.y);
    const area = { x: own.x, y: top, width: Math.max(own.x + own.width, screen.x + screen.width) - own.x, height: own.y + own.height - top };
    context.save();
    context.fillStyle = verticalGradient(context, area, [[0, withAlpha(colors.panelDark, 0.96)], [1, withAlpha(colors.panel, 0.92)]]);
    context.fillRect(area.x, area.y, area.width, area.height);
    context.fillStyle = withAlpha(colors.accent, 0.28);
    context.fillRect(area.x, own.y + own.height - 1, area.width, 1);
    context.restore();
  }
}
