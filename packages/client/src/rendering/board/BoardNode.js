/**
 * Static board furniture drawn beneath the cards: the play zones as sunken,
 * tinted fields over the mat (the active seat's battlefield lit with a warm rim), the turn
 * banner as a ribbon across the middle, and the opponent's hidden hand
 * (card backs). Non-interactive.
 */
import { drawCardBack } from "../cards/CardRenderer.js";
import { shade, withAlpha } from "../theme/color.js";
import { fontFor } from "../theme/Theme.js";
import { drawOutlinedText, fillRoundedRect, glowRoundedRect, insetShadow, verticalGradient } from "../ui/drawing.js";
import { UiNode } from "../ui/UiNode.js";
import { BANNER_INSET_FRACTION } from "./BoardLayout.js";

const ZONE_RADIUS = 14;
const ZONE_DEPTH = 10;
const ACTIVE_GLOW_BLUR = 26;
const RIBBON_NOTCH = 18;
/** How opaque a zone's dark tint is, top to bottom: light enough for the mat beneath to show through. */
const ZONE_TINT = Object.freeze({ top: 0.35, bottom: 0.55 });

export class BoardNode extends UiNode {
  #layout;
  #banner;
  #activePlayerId;

  /**
   * @param {{ layout: import("./BoardLayout.js").BoardLayout, banner: string, activePlayerId: string | null }} options
   */
  constructor({ layout, banner, activePlayerId }) {
    super({ id: "board", width: layout.width, height: layout.height });
    this.passthrough = true;
    this.#layout = layout;
    this.#banner = banner;
    this.#activePlayerId = activePlayerId;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const layout = this.#layout;
    for (const zone of [layout.opponent.hand, layout.me.hand]) {
      this.#paintZone(context, theme, zone, false);
    }
    this.#paintZone(context, theme, layout.opponent.battlefield, this.#activePlayerId === layout.opponent.id);
    this.#paintZone(context, theme, layout.me.battlefield, this.#activePlayerId === layout.me.id);
    this.#paintBanner(context, theme);
    for (const slot of [...layout.opponent.handSlots, ...layout.me.handSlots]) {
      drawCardBack(context, theme, slot);
    }
  }

  /**
   * A sunken field; the active battlefield gets a warm glowing rim.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {import("@magic8/engine/shared/geometry.js").Rect} zone
   * @param {boolean} active
   */
  #paintZone(context, theme, zone, active) {
    const { colors } = theme;
    if (active) {
      glowRoundedRect(context, zone, { color: withAlpha(colors.accent, 0.55), radius: ZONE_RADIUS, blur: ACTIVE_GLOW_BLUR, lineWidth: 2 });
    }
    fillRoundedRect(context, zone, {
      fill: verticalGradient(context, zone, [[0, withAlpha(colors.panelDark, ZONE_TINT.top)], [1, withAlpha(shade(colors.panelDark, -0.5), ZONE_TINT.bottom)]]),
      stroke: active ? withAlpha(colors.accent, 0.7) : withAlpha(colors.panelBorder, 0.7),
      radius: ZONE_RADIUS,
      lineWidth: active ? 2 : 1,
    });
    insetShadow(context, zone, { color: colors.letterbox, radius: ZONE_RADIUS, depth: ZONE_DEPTH });
  }

  /**
   * The turn banner: a ribbon with notched ends across the centre line.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  #paintBanner(context, theme) {
    const { banner } = this.#layout;
    const { colors } = theme;
    const inset = banner.width * BANNER_INSET_FRACTION;
    const ribbon = { x: banner.x + inset, y: banner.y, width: banner.width - 2 * inset, height: banner.height };
    context.save();
    context.beginPath();
    context.moveTo(ribbon.x, ribbon.y);
    context.lineTo(ribbon.x + ribbon.width, ribbon.y);
    context.lineTo(ribbon.x + ribbon.width - RIBBON_NOTCH, ribbon.y + ribbon.height / 2);
    context.lineTo(ribbon.x + ribbon.width, ribbon.y + ribbon.height);
    context.lineTo(ribbon.x, ribbon.y + ribbon.height);
    context.lineTo(ribbon.x + RIBBON_NOTCH, ribbon.y + ribbon.height / 2);
    context.closePath();
    context.shadowColor = withAlpha(colors.letterbox, 0.8);
    context.shadowBlur = 12;
    context.fillStyle = verticalGradient(context, ribbon, [[0, shade(colors.panelLight, 0.05)], [0.5, colors.panel], [1, shade(colors.panelDark, -0.2)]]);
    context.fill();
    context.shadowBlur = 0;
    context.lineWidth = 1.5;
    context.strokeStyle = withAlpha(colors.accent, 0.6);
    context.stroke();
    context.restore();
    drawOutlinedText(context, this.#banner, ribbon, { font: fontFor(theme, "body", "bold"), color: colors.accentLight, outline: withAlpha(colors.letterbox, 0.8), outlineWidth: 3 });
  }
}
