/**
 * The bar across the top of the screen: on the left the game's logo, Back
 * (when the screen has somewhere to go back to) and, on a screen of a
 * section with tabs, its tabs (SectionTabs); no title (the screen names
 * itself, and its section is lit among the tabs). On the right the
 * player's things — what their wallet holds, their ranked entries, the
 * notifications, the settings and their account (or Sign in) — laid from
 * the right edge in; when there is too little room for them (a phone),
 * the ones that matter least give way first (`drop`).
 */
import { Icon } from "../ui/icons.js";
import { IconButton } from "../ui/IconButton.js";
import { GameLogo } from "./GameLogo.js";
import { SectionTabs, tabsWidth } from "./SectionTabs.js";
import { UiNode } from "../ui/UiNode.js";
import { verticalGradient } from "../ui/drawing.js";
import { withAlpha } from "../theme/color.js";

/** Back's width with its caption (a phone's Back is the arrow alone). */
const BACK_WIDTH = 132;
/** The logo's width at the bar's left end, wide and on a phone (it takes the bar's height). */
const LOGO_WIDTH = Object.freeze({ wide: 116, compact: 76 });

/**
 * Something on the right of the bar: its width, how readily it gives way
 * (the lowest `drop` first; Infinity never) and how to make it in the box it gets.
 * @typedef {Readonly<{ id: string, width: number, drop: number, make: (box: import("@magic8/engine/shared/geometry.js").Rect) => UiNode }>} BarControl
 * @typedef {Readonly<{ title: string, back: (() => void) | null }>} Heading the screen's name (the bar does not show it), and
 *   what its Back does (null: no Back)
 * @typedef {Readonly<{ entries: readonly import("./sections.js").TabEntry[], current: string, onOpen: (tab: import("./sections.js").TabEntry) => void }>} BarTabs
 *   a section's tabs: `current`, the scene on show
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
   *   `tabs`: the section's tabs (null: none)
   */
  constructor({ layout, origin, screen, heading, controls, tabs = null }) {
    const { bar, controls: row, compact } = layout;
    super({ id: "shell.bar", x: bar.x - origin.x, y: bar.y - origin.y, width: bar.width, height: bar.height });
    this.#screen = screen;
    const logoWidth = compact ? LOGO_WIDTH.compact : LOGO_WIDTH.wide;
    this.add(new GameLogo({ id: "shell.logo", x: row.padding, y: 0, width: logoWidth, height: bar.height }));
    let left = row.padding + logoWidth + row.gap;
    if (heading.back !== null) {
      const width = compact ? row.height : BACK_WIDTH;
      this.#back = this.add(new IconButton({ id: "shell.back", x: left, y: row.y, width, height: row.height, icon: Icon.BACK, caption: compact ? "" : "Back", onActivate: heading.back }));
      left += width + row.gap;
    }
    if (tabs !== null && tabs.entries.length > 0) {
      this.add(new SectionTabs({ x: left, y: row.y, height: row.height, compact, tabs: tabs.entries, current: tabs.current, onOpen: tabs.onOpen }));
      left += tabsWidth(tabs.entries.length, compact) + row.gap;
    }
    this.#placeControls(controls, { left, right: bar.width - row.padding, row });
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
    // From the screen's left edge to its right one, and up to its top one.
    const top = Math.min(screen.y, own.y);
    const left = Math.min(screen.x, own.x);
    const area = { x: left, y: top, width: Math.max(own.x + own.width, screen.x + screen.width) - left, height: own.y + own.height - top };
    context.save();
    context.fillStyle = verticalGradient(context, area, [[0, withAlpha(colors.panelDark, 0.96)], [1, withAlpha(colors.panel, 0.92)]]);
    context.fillRect(area.x, area.y, area.width, area.height);
    context.fillStyle = withAlpha(colors.accent, 0.28);
    context.fillRect(area.x, own.y + own.height - 1, area.width, 1);
    context.restore();
  }
}
