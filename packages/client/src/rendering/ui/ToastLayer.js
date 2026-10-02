/**
 * Toasts: short messages stacked in the top-right corner above whatever
 * scene is showing (a notification that just arrived). Each fades in,
 * stays a few seconds and fades out; at most a few are shown, the oldest
 * leave first. A toast about another player (a challenge) shows their
 * portrait. A click on a toast calls `onOpen` and dismisses it; clicks
 * elsewhere reach the scene. The SceneManager draws it after the scene.
 */
import { containsPoint } from "@magic8/engine/shared/geometry.js";
import { ellipsize, wrapText } from "../text/textUtils.js";
import { withAlpha } from "../theme/color.js";
import { fontFor } from "../theme/Theme.js";
import { drawAvatar } from "./avatar.js";
import { drawTextInRect, fillRoundedRect, glowRoundedRect } from "./drawing.js";

const TOAST = Object.freeze({ width: 440, height: 92, gap: 12, margin: 20, stripe: 6, padding: 16 });
const MAX_TOASTS = 3;
const LIFE_MS = 6000;
const FADE_MS = 250;
const TONE_KEYS = Object.freeze({ good: "success", bad: "danger", info: "accent" });
const AVATAR_RADIUS = 24;

/**
 * @typedef {Readonly<{ title: string, body: string, tone: "good" | "bad" | "info", account?: string, opens?: string }>} ToastMessage
 *   `account`: the player the toast is about (their portrait is shown); `opens`: where a click leads, for `onOpen`
 * @typedef {{ message: ToastMessage, ageMs: number }} Toast
 */

export class ToastLayer {
  #viewport;
  #onOpen;
  #requestRender;
  /** @type {Toast[]} */
  #toasts = [];

  /**
   * @param {{ viewport: { bounds: import("@magic8/engine/shared/geometry.js").Rect }, onOpen: (message: ToastMessage) => void, requestRender: () => void }} deps
   */
  constructor({ viewport, onOpen, requestRender }) {
    this.#viewport = viewport;
    this.#onOpen = onOpen;
    this.#requestRender = requestRender;
  }

  /** Toasts on screen, newest first (for tests and the scene's layout). */
  get messages() {
    return this.#toasts.map((toast) => toast.message);
  }

  /** @param {ToastMessage} message */
  show(message) {
    this.#toasts.unshift({ message, ageMs: 0 });
    this.#toasts.length = Math.min(this.#toasts.length, MAX_TOASTS);
    this.#requestRender();
  }

  /**
   * @param {number} dtMs
   * @returns {boolean} whether a render is needed (a toast is fading, or one left)
   */
  update(dtMs) {
    if (this.#toasts.length === 0) {
      return false;
    }
    const before = this.#toasts.length;
    for (const toast of this.#toasts) {
      toast.ageMs += dtMs;
    }
    this.#toasts = this.#toasts.filter((toast) => toast.ageMs < LIFE_MS);
    return this.#toasts.length !== before || this.#toasts.some((toast) => toast.ageMs < FADE_MS || toast.ageMs > LIFE_MS - FADE_MS);
  }

  /**
   * A pointer event over a toast is the layer's: a release opens it. Anything else goes on to the scene.
   * @param {{ type: string, x: number, y: number }} input
   * @returns {boolean} whether the layer took the event
   */
  onPointer(input) {
    if (input.type === "wheel") {
      return false;
    }
    const index = this.#toasts.findIndex((_toast, position) => containsPoint(this.#frame(position), input));
    if (index < 0) {
      return false;
    }
    if (input.type === "up") {
      const [toast] = this.#toasts.splice(index, 1);
      this.#requestRender();
      this.#onOpen(toast.message);
    }
    return true;
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   */
  render(context, theme) {
    this.#toasts.forEach((toast, index) => this.#paint(context, theme, toast, this.#frame(index)));
  }

  /** @param {number} index */
  #frame(index) {
    const screen = this.#viewport.bounds;
    return { x: screen.x + screen.width - TOAST.margin - TOAST.width, y: screen.y + TOAST.margin + index * (TOAST.height + TOAST.gap), width: TOAST.width, height: TOAST.height };
  }

  /**
   * @param {CanvasRenderingContext2D} context
   * @param {import("../theme/Theme.js").Theme} theme
   * @param {Toast} toast
   * @param {{ x: number, y: number, width: number, height: number }} frame
   */
  #paint(context, theme, { message, ageMs }, frame) {
    const alpha = Math.max(0, Math.min(1, ageMs / FADE_MS, (LIFE_MS - ageMs) / FADE_MS));
    const tone = /** @type {Record<string, string>} */ (theme.colors)[TONE_KEYS[message.tone]] ?? theme.colors.accent;
    const radius = theme.spacing.radius;
    context.save();
    context.globalAlpha *= alpha;
    glowRoundedRect(context, frame, { color: withAlpha(tone, 0.5), radius, blur: 18, lineWidth: 1.5 });
    fillRoundedRect(context, frame, { fill: withAlpha(theme.colors.panelDark, 0.96), stroke: withAlpha(tone, 0.8), radius, lineWidth: 1.5 });
    fillRoundedRect(context, { x: frame.x, y: frame.y, width: TOAST.stripe, height: frame.height }, { fill: tone, radius: TOAST.stripe / 2 });
    let x = frame.x + TOAST.stripe + TOAST.padding;
    if (message.account !== undefined) {
      drawAvatar(context, theme, { account: message.account, center: { x: x + AVATAR_RADIUS, y: frame.y + frame.height / 2 }, radius: AVATAR_RADIUS });
      x += 2 * AVATAR_RADIUS + TOAST.padding;
    }
    const width = frame.x + frame.width - TOAST.padding - x;
    const titleFont = fontFor(theme, "body", "bold");
    context.font = titleFont;
    drawTextInRect(context, ellipsize((text) => context.measureText(text).width, message.title, width), { x, y: frame.y + 8, width, height: 28 }, { font: titleFont, color: theme.colors.accentLight, align: "left" });
    const bodyFont = fontFor(theme, "small");
    context.font = bodyFont;
    const measure = (text) => context.measureText(text).width;
    const lines = wrapText(measure, message.body, width);
    const shown = lines.slice(0, 2);
    if (lines.length > 2) {
      shown[1] = ellipsize(measure, `${shown[1]} ${lines.slice(2).join(" ")}`, width);
    }
    shown.forEach((line, index) => drawTextInRect(context, line, { x, y: frame.y + 38 + index * 22, width, height: 22 }, { font: bodyFont, color: theme.colors.text, align: "left" }));
    context.restore();
  }
}
