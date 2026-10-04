import { SoundCue } from "../../application/audio/SoundCue.js";
import { bevelRoundedRect, drawTextInRect, fillRoundedRect, glowRoundedRect, radialGradient, roundedRectPath, verticalGradient } from "./drawing.js";
import { UiNode } from "./UiNode.js";
import { inPixels, UiPiece } from "../images/UiArt.js";
import { ellipsize } from "../text/textUtils.js";
import { shade, withAlpha } from "../theme/color.js";
import { fontFor } from "../theme/Theme.js";

const TEXT_PADDING = Object.freeze({ body: 14, small: 8 });
const GLOW_BLUR = 16;
const FOCUS_LINE_WIDTH = 3;
/**
 * The painted plates: how much of a button's width their two ornate ends may
 * take at most, the narrowest they are drawn (a share of their own width:
 * narrower, the ornaments would no longer read), the gap kept between the
 * label and them, how far the label keeps from them (a fraction of an end's
 * width), and the washes laid over the plate for each state.
 */
const PLATE = Object.freeze({
  maxCapsShare: 0.8,
  minEnds: 0.45,
  labelGap: 4,
  textClearance: 0.6,
  disabledAlpha: 0.55,
  wash: Object.freeze({ hover: 0.1, pressed: 0.3, danger: 0.32, disabled: 0.5, primaryGlow: 0.22 }),
});

/** The sound of each variant: a plain tick, a confirming pluck, a low knock before what cannot be undone. */
const VARIANT_CUES = Object.freeze({ primary: SoundCue.UI_CONFIRM, secondary: SoundCue.UI_CLICK, danger: SoundCue.UI_DANGER });

/** @typedef {"primary" | "secondary" | "danger"} ButtonVariant */
/** @typedef {"body" | "small"} ButtonTextSize */
/**
 * @typedef {{
 *   image: import("../images/ImageCache.js").LoadedImage,
 *   source: { x: number, y: number, width: number, height: number },
 *   caps: { left: number, right: number },
 *   ends: { left: number, right: number },
 *   scale: number,
 *   radius: number,
 * }} Plate a plate fitted to the button: `source` and `caps` (its ornate ends) in image pixels, `scale` image → button (its height),
 *   `ends` the ornate ends as drawn and `radius`, in button pixels
 */

/**
 * Clickable, focusable text button, drawn as a bevelled slab with a
 * gradient in the variant's colour; hover lifts it, pressing sinks it,
 * focus and hover add a halo. `onActivate` fires on click, tap, Enter or Space.
 * `textSize: "small"` fits short labels into narrow buttons (filter rows).
 * Once its image is ready (Theme.uiArt) every button is laid on the same
 * painted plate instead, ornate ends and all: the plain middle stretched to
 * the width, the ends at the plate's own proportions where there is room,
 * drawn narrower where there is not (a narrow button, a long label: on a
 * phone), so the label always stands clear of them. A label too long for
 * the body size is set in the small size before it is ever shortened.
 * Activating it makes its variant's sound (`cue` to choose another, or none).
 */
export class Button extends UiNode {
  text;
  /** @type {() => void} */
  onActivate;
  /** @type {ButtonVariant} */
  variant;
  /** @type {CanvasTextAlign} */
  align;
  /** @type {ButtonTextSize} */
  textSize;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, enabled?: boolean, text: string, onActivate: () => void, variant?: ButtonVariant, align?: CanvasTextAlign, textSize?: ButtonTextSize, cue?: string | null }} options
   *   `cue`: the sound it makes (a SoundCue; null for none), when not its variant's
   */
  constructor(options) {
    super(options);
    this.text = options.text;
    this.onActivate = options.onActivate;
    this.variant = options.variant ?? "secondary";
    this.align = options.align ?? "center";
    this.textSize = options.textSize ?? "body";
    this.interactive = true;
    this.focusable = true;
    this.activationCue = options.cue === undefined ? VARIANT_CUES[this.variant] : options.cue;
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
    const look = this.#look(theme);
    const plate = this.#plate(context, theme);
    const radius = plate === null ? theme.spacing.radius : plate.radius;
    if (look.halo !== null) {
      glowRoundedRect(context, area, { color: look.halo, radius, blur: GLOW_BLUR, lineWidth: 2, alpha: 0.9 });
    }
    if (plate !== null) {
      this.#paintPlate(context, theme, plate);
      this.#paintText(context, theme, this.#plateTextColor(theme), Math.max(TEXT_PADDING[this.textSize], Math.max(plate.ends.left, plate.ends.right) * PLATE.textClearance));
      return;
    }
    fillRoundedRect(context, area, { fill: verticalGradient(context, area, look.gradient), stroke: look.stroke, radius, lineWidth: this.focused ? FOCUS_LINE_WIDTH : 1.5 });
    if (look.bevel) {
      bevelRoundedRect(context, area, { light: withAlpha("#ffffff", 0.22), dark: withAlpha("#000000", 0.45), radius });
    }
    this.#paintText(context, theme, look.text, TEXT_PADDING[this.textSize]);
  }

  /**
   * The painted plate fitted to this button, or null while there is no art
   * (yet). Primary buttons have their own plate; every other variant shares one.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @returns {Plate | null}
   */
  #plate(context, theme) {
    const art = theme.uiArt;
    if (art === undefined) {
      return null;
    }
    const primary = this.variant === "primary";
    const image = art.imageFor(primary ? UiPiece.BUTTON_PRIMARY : UiPiece.BUTTON_SECONDARY);
    if (image === null) {
      return null;
    }
    const layout = primary ? art.layout.buttons.primary : art.layout.buttons.secondary;
    const source = inPixels(layout.plate, image);
    const scale = this.height / source.height;
    const caps = { left: layout.caps.left * source.width, right: layout.caps.right * source.width };
    const fit = this.#endsFit(context, theme, { left: caps.left * scale, right: caps.right * scale });
    return { image, source, caps, ends: { left: caps.left * scale * fit, right: caps.right * scale * fit }, scale, radius: layout.radius * this.height };
  }

  /**
   * How much of their own width the ornate ends are drawn at: all of it
   * where there is room; less where their share of the width or the label
   * between them needs it (the label measured in the size it is set in),
   * never under PLATE.minEnds.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {{ left: number, right: number }} whole the ends at the plate's own proportions, in button pixels
   */
  #endsFit(context, theme, whole) {
    const widest = Math.max(whole.left, whole.right);
    const share = (this.width * PLATE.maxCapsShare) / (whole.left + whole.right);
    const fitFor = (/** @type {ButtonTextSize} */ size) => {
      context.font = fontFor(theme, size, "bold");
      const room = (this.width - context.measureText(this.text).width) / 2 - PLATE.labelGap;
      return Math.min(1, share, room / widest);
    };
    let fit = fitFor(this.textSize);
    if (fit < PLATE.minEnds && this.textSize === "body") {
      // #paintText sets such a label in the small size: the ends make room for that one.
      fit = fitFor("small");
    }
    return Math.max(PLATE.minEnds, fit);
  }

  /**
   * The plate in three slices, cut along its rounded outline, then washed
   * for the variant and state; a focus ring on top.
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {Plate} plate
   */
  #paintPlate(context, theme, plate) {
    const area = this.bounds;
    const { colors } = theme;
    const { image, source, caps } = plate;
    const enabled = this.isEffectivelyEnabled;
    const { left, right } = plate.ends;
    context.save();
    roundedRectPath(context, area, plate.radius);
    context.clip();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    if (!enabled) {
      context.globalAlpha = PLATE.disabledAlpha;
    }
    // The middle overlaps the ends by a pixel so no seam shows between the slices.
    context.drawImage(image.source, source.x + caps.left, source.y, source.width - caps.left - caps.right, source.height, area.x + left - 1, area.y, area.width - left - right + 2, area.height);
    context.drawImage(image.source, source.x, source.y, caps.left, source.height, area.x, area.y, left, area.height);
    context.drawImage(image.source, source.x + source.width - caps.right, source.y, caps.right, source.height, area.x + area.width - right, area.y, right, area.height);
    context.globalAlpha = 1;
    if (enabled && this.variant === "primary") {
      const center = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
      context.fillStyle = radialGradient(context, center, area.width / 2, [[0, withAlpha(colors.accent, PLATE.wash.primaryGlow)], [1, withAlpha(colors.accent, 0)]]);
      context.fillRect(area.x, area.y, area.width, area.height);
    }
    const wash = this.#plateWash(theme);
    if (wash !== null) {
      context.fillStyle = wash;
      context.fillRect(area.x, area.y, area.width, area.height);
    }
    context.restore();
    if (this.focused) {
      fillRoundedRect(context, area, { stroke: colors.focus, radius: plate.radius, lineWidth: FOCUS_LINE_WIDTH });
    }
  }

  /**
   * The colour laid over the plate: disabled greys it, danger reddens it,
   * pressing sinks it, the pointer lifts it.
   * @param {import("../theme/Theme.js").Theme} theme
   * @returns {string | null}
   */
  #plateWash(theme) {
    const { colors } = theme;
    const { wash } = PLATE;
    if (!this.isEffectivelyEnabled) {
      return withAlpha(colors.disabled, wash.disabled);
    }
    if (this.pressed) {
      return withAlpha("#000000", wash.pressed);
    }
    if (this.variant === "danger") {
      return withAlpha(colors.danger, wash.danger + (this.hovered ? wash.hover : 0));
    }
    return this.hovered ? withAlpha(colors.accentLight, wash.hover) : null;
  }

  /**
   * The label's colour on a plate: gold on the primary one, light on the others.
   * @param {import("../theme/Theme.js").Theme} theme
   */
  #plateTextColor(theme) {
    const { colors } = theme;
    if (!this.isEffectivelyEnabled) {
      return colors.disabledText;
    }
    return this.variant === "primary" ? colors.accentLight : colors.text;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {string} color
   * @param {number} padding
   */
  #paintText(context, theme, color, padding) {
    const budget = Math.max(0, this.width - 2 * padding);
    let font = fontFor(theme, this.textSize, "bold");
    context.font = font;
    if (this.textSize === "body" && context.measureText(this.text).width > budget) {
      // Too long for the body size (a narrow button on a phone): the small size before an ellipsis.
      font = fontFor(theme, "small", "bold");
      context.font = font;
    }
    const text = ellipsize((candidate) => context.measureText(candidate).width, this.text, budget);
    drawTextInRect(context, text, this.bounds, { font, color, align: this.align, padding });
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
    if (!this.hovered) {
      return null;
    }
    return withAlpha(this.variant === "secondary" ? theme.colors.accent : fill, 0.7);
  }
}
