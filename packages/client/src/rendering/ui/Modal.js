/**
 * A full-scene backdrop that owns a centred panel. While a modal is open the
 * scene routes focus only inside it; the backdrop itself is interactive so
 * clicks outside the panel dismiss instead of reaching what is underneath.
 * Over a phone's screen the panel wears the small painted corners, as the
 * phone's panels do (dialogSmallCorners).
 */
import { glowRoundedRect, radialGradient } from "./drawing.js";
import { Panel, dialogSmallCorners } from "./Panel.js";
import { UiNode } from "./UiNode.js";
import { withAlpha } from "../theme/color.js";

const BACKDROP_ALPHA = 0.72;
const PANEL_GLOW_BLUR = 40;

export class Modal extends UiNode {
  /** Content container, centred in the backdrop. @type {Panel} */
  panel;
  /** @type {() => void} */
  onDismiss;

  /**
   * @param {{ id?: string, width: number, height: number, panelWidth: number, panelHeight: number, onDismiss: () => void }} options
   */
  constructor(options) {
    super({ id: options.id, width: options.width, height: options.height });
    this.onDismiss = options.onDismiss;
    this.interactive = true;
    this.panel = this.add(
      new Panel({
        id: `${this.id}.panel`,
        x: Math.round((options.width - options.panelWidth) / 2),
        y: Math.round((options.height - options.panelHeight) / 2),
        width: options.panelWidth,
        height: options.panelHeight,
        smallCorners: dialogSmallCorners(options.height),
      }),
    );
  }

  /**
   * Stretches the backdrop over `area` (the whole screen) and keeps the
   * panel where it was, centred on the design area.
   * @param {import("@magic8/engine/shared/geometry.js").Rect} area
   */
  cover(area) {
    this.panel.x += this.x - area.x;
    this.panel.y += this.y - area.y;
    this.x = area.x;
    this.y = area.y;
    this.width = area.width;
    this.height = area.height;
  }

  /**
   * Centres the panel on `area` (in the same coordinates as the backdrop's parent): a screen whose
   * content sits in a frame centres its dialogs on the whole design area all the same.
   * @param {import("@magic8/engine/shared/geometry.js").Rect} area
   */
  centerOn(area) {
    this.panel.x = Math.round(area.x + (area.width - this.panel.width) / 2 - this.x);
    this.panel.y = Math.round(area.y + (area.height - this.panel.height) / 2 - this.y);
  }

  /** A release on the backdrop (outside the panel) dismisses. */
  activate() {
    this.onDismiss();
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const { x, y, width, height } = this.bounds;
    const panel = this.panel.bounds;
    const center = { x: panel.x + panel.width / 2, y: panel.y + panel.height / 2 };
    context.save();
    context.globalAlpha = BACKDROP_ALPHA;
    context.fillStyle = theme.colors.letterbox;
    context.fillRect(x, y, width, height);
    context.globalAlpha = 1;
    // A dim halo behind the panel so it reads as lit from within the darkened scene.
    context.fillStyle = radialGradient(context, center, Math.max(panel.width, panel.height), [[0, withAlpha(theme.colors.backgroundGlow, 0.5)], [1, withAlpha(theme.colors.backgroundGlow, 0)]]);
    context.fillRect(x, y, width, height);
    glowRoundedRect(context, panel, { color: withAlpha(theme.colors.accent, 0.35), radius: theme.spacing.radius, blur: PANEL_GLOW_BLUR, lineWidth: 2 });
    context.restore();
  }
}
