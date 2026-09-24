/**
 * Owns the <canvas> element: keeps its backing store in sync with its CSS
 * size and the device pixel ratio, and exposes the 2D context. The window
 * is injected so the class can be exercised without a DOM.
 */
export class CanvasHost {
  #canvas;
  #context;
  #viewport;
  #window;
  #onResize;
  /** @type {(() => void) | null} */
  #detach = null;

  /**
   * @param {{ canvas: HTMLCanvasElement, viewport: import("./Viewport.js").Viewport, window: Pick<Window, "addEventListener" | "removeEventListener" | "devicePixelRatio">, onResize?: () => void }} deps
   */
  constructor({ canvas, viewport, window, onResize = () => undefined }) {
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("CanvasHost: 2D context unavailable");
    }
    this.#canvas = canvas;
    this.#context = context;
    this.#viewport = viewport;
    this.#window = window;
    this.#onResize = onResize;
  }

  get context() {
    return this.#context;
  }

  get canvas() {
    return this.#canvas;
  }

  /** Starts tracking window resizes. */
  attach() {
    const handler = () => this.syncSize();
    this.#window.addEventListener("resize", handler);
    this.#detach = () => this.#window.removeEventListener("resize", handler);
    this.syncSize();
  }

  detach() {
    this.#detach?.();
    this.#detach = null;
  }

  /** Re-reads the CSS size and updates the viewport and backing store. */
  syncSize() {
    const cssWidth = this.#canvas.clientWidth;
    const cssHeight = this.#canvas.clientHeight;
    this.#viewport.resize({ cssWidth, cssHeight, devicePixelRatio: this.#window.devicePixelRatio || 1 });
    const { width, height } = this.#viewport.deviceSize;
    if (this.#canvas.width !== width || this.#canvas.height !== height) {
      this.#canvas.width = width;
      this.#canvas.height = height;
    }
    this.#onResize();
  }

  /** Canvas position in the page, for pointer coordinate conversion. */
  boundingRect() {
    return this.#canvas.getBoundingClientRect();
  }
}
