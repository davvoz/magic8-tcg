/**
 * Single-line text entry driven by keydown events routed through the scene.
 * Deliberately minimal: append/backspace at the end, a fixed character
 * allow-list and a hard length cap. The value is presentation state; the
 * owner validates it through the application service on change/submit.
 *
 * On a phone there are no keydown events to route: a tap opens the device's
 * own keyboard in a native input (Scene → `services.textEntry`), which hands
 * whole values back through `enter` under the same allow-list and cap.
 * `keyboard` tells that input which keyboard to show.
 */
import { drawTextInRect, fillRoundedRect, glowRoundedRect, insetShadow } from "./drawing.js";
import { UiNode } from "./UiNode.js";
import { withAlpha } from "../theme/color.js";
import { fontFor } from "../theme/Theme.js";

/** Letters and digits of any script, space and a few punctuation marks; nothing that needs escaping anywhere. */
const ALLOWED_CHARACTER = /^[\p{L}\p{N} \-_'.!?&()]$/u;
const HARD_MAX_LENGTH = 200;
const PADDING = 14;
const CARET = "|";

/** @typedef {"text" | "account" | "decimal"} KeyboardKind plain text, a lower-case account name (no capitals, no corrections), a number */

export class TextField extends UiNode {
  /** @type {string} */
  value;
  /** @type {string} */
  placeholder;
  /** @type {number} */
  maxLength;
  /** @type {(value: string) => void} */
  onChange;
  /** @type {() => void} */
  onSubmit;
  /** @type {KeyboardKind} */
  keyboard;

  /**
   * @param {{ id?: string, x?: number, y?: number, width?: number, height?: number, enabled?: boolean, value?: string, placeholder?: string, maxLength?: number, keyboard?: KeyboardKind, onChange?: (value: string) => void, onSubmit?: () => void }} options
   */
  constructor(options) {
    super(options);
    this.maxLength = Math.min(HARD_MAX_LENGTH, Math.max(1, options.maxLength ?? HARD_MAX_LENGTH));
    this.value = (options.value ?? "").slice(0, this.maxLength);
    this.placeholder = options.placeholder ?? "";
    this.onChange = options.onChange ?? (() => undefined);
    this.onSubmit = options.onSubmit ?? (() => undefined);
    this.keyboard = options.keyboard ?? "text";
    this.interactive = true;
    this.focusable = true;
    this.editsText = true;
  }

  /**
   * A whole value typed elsewhere (the device's keyboard): characters outside
   * the allow-list are dropped and the length capped, as when typed here.
   * @param {string} text
   * @returns {string} the value kept
   */
  enter(text) {
    if (this.isEffectivelyEnabled) {
      this.#setValue(Array.from(String(text)).filter((character) => ALLOWED_CHARACTER.test(character)).join("").slice(0, this.maxLength));
    }
    return this.value;
  }

  /** Clicking a field only focuses it (the scene does that on press). */
  activate() {
    // Nothing to trigger; focus already moved here on pointer down.
  }

  /** @param {import("../../input/InputManager.js").KeyInput} input */
  handleKey(input) {
    if (input.type !== "keydown" || !this.isEffectivelyEnabled) {
      return false;
    }
    if (input.key === "Backspace") {
      this.#setValue(this.value.slice(0, -1));
      return true;
    }
    if (input.key === "Enter") {
      this.onSubmit();
      return true;
    }
    if (ALLOWED_CHARACTER.test(input.key)) {
      if (this.value.length < this.maxLength) {
        this.#setValue(this.value + input.key);
      }
      return true;
    }
    return false;
  }

  /** @param {string} next */
  #setValue(next) {
    if (next === this.value) {
      return;
    }
    this.value = next;
    this.onChange(next);
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  paint(context, theme) {
    const enabled = this.isEffectivelyEnabled;
    const radius = theme.spacing.radius;
    if (this.focused) {
      glowRoundedRect(context, this.bounds, { color: withAlpha(theme.colors.focus, 0.8), radius, blur: 12, lineWidth: 2 });
    }
    fillRoundedRect(context, this.bounds, {
      fill: enabled ? theme.colors.panelDark : theme.colors.disabled,
      stroke: this.focused ? theme.colors.focus : theme.colors.panelBorder,
      radius,
      lineWidth: this.focused ? 2 : 1.5,
    });
    insetShadow(context, this.bounds, { color: theme.colors.letterbox, radius, depth: 4 });
    const empty = this.value.length === 0;
    const typed = this.focused ? this.value + CARET : this.value;
    const shown = empty && !this.focused ? this.placeholder : typed;
    const color = empty && !this.focused ? theme.colors.textMuted : theme.colors.text;
    drawTextInRect(context, shown, this.bounds, { font: fontFor(theme, "body"), color: enabled ? color : theme.colors.disabledText, align: "left", padding: PADDING });
  }
}
