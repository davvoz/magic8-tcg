import { bevelRoundedRect, drawTextInRect, fillRoundedRect, glowRoundedRect, verticalGradient } from "./drawing.js";
import { UiNode } from "./UiNode.js";
import { ellipsize } from "../text/textUtils.js";
import { shade, withAlpha } from "../theme/color.js";
import { fontFor } from "../theme/Theme.js";

const TEXT_PADDING = 14;
const GLOW_BLUR = 16;
const FOCUS_LINE_WIDTH = 3;

/** @typedef {"primary" | "secondary" | "danger"} ButtonVariant */

/**
 * Clickable, focusable text button, drawn as a bevelled slab with a
 * gradient in the variant's colour; hover lifts it, pressing sinks it,
 * focus and hover add a halo. `onActivate` fires on click, tap, Enter or Space.
 */
export class Button extends UiNode {
  text;
  /** @type {() => void} */
  onActivate;
  /** @type {ButtonVariant} */
  variant;
  /** @type {CanvasTextAlign} */
  align;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, enabled?: boolean, text: string, onActivate: () => void, variant?: ButtonVariant, align?: CanvasTextAlign }} options
   */
  constructor(options) {
    super(options);
    this.text = options.text;
    this.onActivate = options.onActivate;
    this.variant = options.variant ?? "secondary";
    this.align = options.align ?? "center";
    this.interactive = true;
    this.focusable = true;
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
    const radius = theme.spacing.radius;
    const look = this.#look(theme);
    if (look.halo !== null) {
      glowRoundedRect(context, area, { color: look.halo, radius, blur: GLOW_BLUR, lineWidth: 2, alpha: 0.9 });
    }
    fillRoundedRect(context, area, { fill: verticalGradient(context, area, look.gradient), stroke: look.stroke, radius, lineWidth: this.focused ? FOCUS_LINE_WIDTH : 1.5 });
    if (look.bevel) {
      bevelRoundedRect(context, area, { light: withAlpha("#ffffff", 0.22), dark: withAlpha("#000000", 0.45), radius });
    }
    this.#paintText(context, theme, look.text);
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {string} color
   */
  #paintText(context, theme, color) {
    const font = fontFor(theme, "body", "bold");
    context.font = font;
    const text = ellipsize((candidate) => context.measureText(candidate).width, this.text, Math.max(0, this.width - 2 * TEXT_PADDING));
    drawTextInRect(context, text, this.bounds, { font, color, align: this.align, padding: TEXT_PADDING });
  }

  /**
   * Colours for the current variant and interaction state.
   * @param {import("../theme/Theme.js").Theme} theme
   * @returns {{ gradient: readonly (readonly [number, string])[], stroke: string, text: string, halo: string | null, bevel: boolean }}
   */
  #look(theme) {
    const { colors } = theme;
    if (!this.isEffectivelyEnabled) {
      return { gradient: [[0, colors.disabled], [1, shade(colors.disabled, -0.25)]], stroke: shade(colors.disabled, -0.2), text: colors.disabledText, halo: null, bevel: false };
    }
    const base = this.#baseColor(theme);
    const lift = this.hovered && !this.pressed ? 0.12 : 0;
    const top = this.pressed ? shade(base.fill, -0.2) : shade(base.fill, 0.18 + lift);
    const bottom = this.pressed ? shade(base.fill, -0.35) : shade(base.fill, -0.22 + lift);
    const halo = this.#haloColor(theme, base.fill);
    return {
      gradient: this.pressed ? [[0, bottom], [1, top]] : [[0, top], [1, bottom]],
      stroke: this.focused ? colors.focus : base.stroke,
      text: base.text,
      halo,
      bevel: !this.pressed,
    };
  }

  /** @param {import("../theme/Theme.js").Theme} theme */
  #baseColor(theme) {
    const { colors } = theme;
    if (this.variant === "primary") {
      return { fill: colors.accent, stroke: colors.accentDark, text: colors.accentText };
    }
    if (this.variant === "danger") {
      return { fill: shade(colors.danger, -0.35), stroke: colors.danger, text: colors.text };
    }
    return { fill: colors.panelLight, stroke: colors.panelBorder, text: colors.text };
  }

  /**
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {string} fill
   */
  #haloColor(theme, fill) {
    if (this.focused) {
      return theme.colors.focus;
    }
    return this.hovered ? withAlpha(this.variant === "secondary" ? theme.colors.accent : fill, 0.7) : null;
  }
}
