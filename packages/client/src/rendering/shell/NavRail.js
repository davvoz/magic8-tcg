/**
 * The rail down the left edge of the screen: the game's name at its top,
 * then the five sections (sections.js), the one on show lit. Its stone
 * reaches the screen's edges (a window of another shape, a notch), its
 * entries stay inside the design area.
 */
import { UiPiece } from "../images/UiArt.js";
import { drawTextInRect, verticalGradient } from "../ui/drawing.js";
import { UiNode } from "../ui/UiNode.js";
import { withAlpha } from "../theme/color.js";
import { displayFont } from "../theme/Theme.js";
import { NavItem } from "./NavItem.js";

/** How much of the logo's cell the painted name may fill. */
const LOGO_FILL = 0.86;

/**
 * One entry of the rail: a section and where it leads now.
 * @typedef {Readonly<{ section: import("./sections.js").Section, destination: import("./sections.js").SectionDestination }>} RailEntry
 */

export class NavRail extends UiNode {
  /** @type {() => import("@magic8/engine/shared/geometry.js").Rect} */
  #screen;
  /** @type {import("@magic8/engine/shared/geometry.js").Rect} */
  #logo;

  /**
   * @param {{
   *   layout: import("./ShellLayout.js").ShellLayout,
   *   origin: { x: number, y: number },
   *   screen: () => import("@magic8/engine/shared/geometry.js").Rect,
   *   entries: readonly RailEntry[],
   *   current: string | null,
   *   onOpen: (entry: RailEntry) => void,
   * }} options `origin`: where the content starts (the rail is laid out left of it); `screen`: the whole canvas, in the
   *   same coordinates; `current`: the section on show
   */
  constructor({ layout, origin, screen, entries, current, onOpen }) {
    super({ id: "shell.rail", x: layout.rail.x - origin.x, y: layout.rail.y - origin.y, width: layout.rail.width, height: layout.rail.height });
    this.#screen = screen;
    this.#logo = { x: layout.logo.x - origin.x, y: layout.logo.y - origin.y, width: layout.logo.width, height: layout.logo.height };
    const { items } = layout;
    entries.forEach((entry, index) => {
      this.add(
        new NavItem({
          id: `shell.nav.${entry.section.id}`,
          x: items.x,
          y: items.top + index * (items.height + items.gap),
          width: items.width,
          height: items.height,
          label: entry.section.label,
          icon: entry.section.icon,
          selected: entry.section.id === current,
          locked: "locked" in entry.destination,
          onActivate: () => onOpen(entry),
        }),
      );
    });
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const { colors } = theme;
    const own = this.bounds;
    const screen = this.#screen();
    // From the screen's left, top and bottom edges to the rail's right one.
    const area = { x: Math.min(screen.x, own.x), y: Math.min(screen.y, own.y), width: own.x + own.width - Math.min(screen.x, own.x), height: Math.max(screen.y + screen.height, own.y + own.height) - Math.min(screen.y, own.y) };
    context.save();
    context.fillStyle = verticalGradient(context, area, [[0, withAlpha(colors.panelDark, 0.96)], [1, withAlpha(colors.background, 0.96)]]);
    context.fillRect(area.x, area.y, area.width, area.height);
    context.fillStyle = withAlpha(colors.accent, 0.28);
    context.fillRect(own.x + own.width - 1, area.y, 1, area.height);
    context.restore();
    this.#paintLogo(context, theme);
  }

  /**
   * The game's name in the rail's top cell: the painted logo once ready, else its letters in gold.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  #paintLogo(context, theme) {
    const cell = this.#logo;
    const image = theme.uiArt?.imageFor(UiPiece.TITLE) ?? null;
    if (image === null) {
      drawTextInRect(context, "KIJAM", cell, { font: displayFont(theme, Math.round(cell.height * 0.36)), color: theme.colors.accentLight });
      return;
    }
    const scale = Math.min((cell.width * LOGO_FILL) / image.width, (cell.height * LOGO_FILL) / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.save();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image.source, cell.x + (cell.width - width) / 2, cell.y + (cell.height - height) / 2, width, height);
    context.restore();
  }
}
