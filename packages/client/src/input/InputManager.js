/**
 * Attaches DOM listeners (never inline handlers) and normalises mouse,
 * touch and pen into one pointer event type in logical coordinates, plus a
 * simplified keyboard event. Everything is forwarded to a single target —
 * the SceneManager — which decides what the input means.
 *
 * @typedef {Readonly<{ type: "down" | "move" | "up" | "cancel", x: number, y: number, button: number, pointerId: number }>} PointerInput
 * @typedef {Readonly<{ type: "wheel", x: number, y: number, deltaY: number }>} WheelInput
 * @typedef {Readonly<{ type: "keydown" | "keyup", key: string, repeat: boolean }>} KeyInput
 */
import { KEYS_WITH_SUPPRESSED_DEFAULT } from "./KeyMap.js";

const MAX_WHEEL_DELTA = 200;

export class InputManager {
  #canvas;
  #window;
  #viewport;
  #target;
  /** @type {(() => void)[]} */
  #detachers = [];

  /**
   * @param {{ canvas: HTMLCanvasElement, window: Pick<Window, "addEventListener" | "removeEventListener">, viewport: import("../rendering/canvas/Viewport.js").Viewport, target: { onPointer: (input: PointerInput | WheelInput) => void, onKey: (input: KeyInput) => void } }} deps
   */
  constructor({ canvas, window, viewport, target }) {
    this.#canvas = canvas;
    this.#window = window;
    this.#viewport = viewport;
    this.#target = target;
  }

  attach() {
    this.#listen(this.#canvas, "pointerdown", (event) => this.#pointer("down", /** @type {PointerEvent} */ (event)));
    this.#listen(this.#canvas, "pointermove", (event) => this.#pointer("move", /** @type {PointerEvent} */ (event)));
    this.#listen(this.#window, "pointerup", (event) => this.#pointer("up", /** @type {PointerEvent} */ (event)));
    this.#listen(this.#window, "pointercancel", (event) => this.#pointer("cancel", /** @type {PointerEvent} */ (event)));
    this.#listen(this.#canvas, "wheel", (event) => this.#wheel(/** @type {WheelEvent} */ (event)), { passive: false });
    this.#listen(this.#canvas, "contextmenu", (event) => event.preventDefault());
    this.#listen(this.#window, "keydown", (event) => this.#key("keydown", /** @type {KeyboardEvent} */ (event)));
    this.#listen(this.#window, "keyup", (event) => this.#key("keyup", /** @type {KeyboardEvent} */ (event)));
  }

  detach() {
    for (const detach of this.#detachers) {
      detach();
    }
    this.#detachers = [];
  }

  /**
   * @param {{ addEventListener: Function, removeEventListener: Function }} source
   * @param {string} type
   * @param {(event: Event) => void} handler
   * @param {AddEventListenerOptions} [options]
   */
  #listen(source, type, handler, options) {
    source.addEventListener(type, handler, options);
    this.#detachers.push(() => source.removeEventListener(type, handler, options));
  }

  /**
   * @param {"down" | "move" | "up" | "cancel"} type
   * @param {PointerEvent} event
   */
  #pointer(type, event) {
    if (type === "down") {
      event.preventDefault();
      this.#canvas.setPointerCapture?.(event.pointerId);
    }
    const { x, y } = this.#toLogical(event.clientX, event.clientY);
    this.#target.onPointer(Object.freeze({ type, x, y, button: event.button ?? 0, pointerId: event.pointerId ?? 0 }));
  }

  /** @param {WheelEvent} event */
  #wheel(event) {
    event.preventDefault();
    const { x, y } = this.#toLogical(event.clientX, event.clientY);
    const deltaY = Math.max(-MAX_WHEEL_DELTA, Math.min(MAX_WHEEL_DELTA, event.deltaY));
    this.#target.onPointer(Object.freeze({ type: "wheel", x, y, deltaY }));
  }

  /**
   * @param {"keydown" | "keyup"} type
   * @param {KeyboardEvent} event
   */
  #key(type, event) {
    if (typeof event.key !== "string" || event.ctrlKey === true || event.metaKey === true || event.altKey === true) {
      // Browser/OS shortcuts (reload, tab switching, AltGr characters) are not game input.
      return;
    }
    if (KEYS_WITH_SUPPRESSED_DEFAULT.includes(event.key)) {
      event.preventDefault();
    }
    this.#target.onKey(Object.freeze({ type, key: event.key, repeat: event.repeat === true }));
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   */
  #toLogical(clientX, clientY) {
    const rectangle = this.#canvas.getBoundingClientRect();
    return this.#viewport.toLogical(clientX - rectangle.left, clientY - rectangle.top);
  }
}
