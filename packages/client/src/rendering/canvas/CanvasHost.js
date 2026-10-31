/**
 * Owns the <canvas> element: keeps its backing store in sync with its CSS
 * size and the device pixel ratio, and exposes the 2D context. The window
 * is injected so the class can be exercised without a DOM.
 *
 * A window "resize" is not enough to know the canvas changed: an installed
 * app opening on a phone may settle its size (the status and navigation bars
 * placed) without one, or before its layout is done, and the page then
 * stretches a backing store of the wrong size until the next resize. So the
 * canvas box itself is watched (ResizeObserver), with the elements whose size
 * says the safe area moved, and the screen's pixel density.
 *
 * Full screen, the phone's bars only pass over the game (BarsHold): the
 * canvas is then sized by the script to the held reading, not by the page.
 */
export class CanvasHost {
  #canvas;
  #context;
  #viewport;
  #window;
  #onResize;
  #observed;
  /** @type {import("./BarsHold.js").BarsHold | null} */
  #hold;
  /** Whether the canvas has a size of the script's (held), not the page's. */
  #pinned = false;
  /** @type {(() => void) | null} */
  #detach = null;
  /** What the last sync read: the same reading again changes nothing. */
  #lastReading = "";

  /** @type {() => Partial<import("./Viewport.js").Insets>} */
  #insets;

  /**
   * @param {{
   *   canvas: HTMLCanvasElement, viewport: import("./Viewport.js").Viewport,
   *   window: Pick<Window, "addEventListener" | "removeEventListener" | "devicePixelRatio" | "innerWidth" | "innerHeight"> & { ResizeObserver?: typeof ResizeObserver, matchMedia?: Window["matchMedia"] },
   *   onResize?: () => void, insets?: () => Partial<import("./Viewport.js").Insets>, observed?: readonly Element[],
   *   hold?: import("./BarsHold.js").BarsHold | null,
   * }} deps
   *   `insets`: the screen's unsafe edges (notch, home indicator) in CSS pixels, read at every resize;
   *   `observed`: other elements whose size changing means the screen did (the safe-area probe; the page's size, while the
   *   canvas has one of its own); `hold`: keeps the screen still while the phone's bars pass (none: every change followed)
   */
  constructor({ canvas, viewport, window, onResize = () => undefined, insets = () => ({}), observed = [], hold = null }) {
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("CanvasHost: 2D context unavailable");
    }
    this.#canvas = canvas;
    this.#context = context;
    this.#viewport = viewport;
    this.#window = window;
    this.#onResize = onResize;
    this.#insets = insets;
    this.#observed = observed;
    this.#hold = hold;
  }

  get context() {
    return this.#context;
  }

  get canvas() {
    return this.#canvas;
  }

  /**
   * Starts tracking the canvas size: window resizes (a phone turning reports one too, sometimes only as an orientation
   * change), the app shown again, the canvas box and the safe area changing, the pixel density changing.
   */
  attach() {
    const handler = () => this.syncSize();
    const events = ["resize", "orientationchange", "pageshow"];
    for (const type of events) {
      this.#window.addEventListener(type, handler);
    }
    const unobserve = this.#observeBoxes(handler);
    const unwatchDensity = this.#watchDensity(handler);
    this.#detach = () => {
      for (const type of events) {
        this.#window.removeEventListener(type, handler);
      }
      unobserve();
      unwatchDensity();
    };
    this.syncSize();
  }

  detach() {
    this.#detach?.();
    this.#detach = null;
  }

  /** Re-reads the CSS size and updates the viewport and backing store, when any of it changed. */
  syncSize() {
    const { cssWidth, cssHeight, insets } = this.#measure();
    const devicePixelRatio = this.#window.devicePixelRatio || 1;
    const reading = JSON.stringify([cssWidth, cssHeight, devicePixelRatio, insets]);
    if (reading === this.#lastReading) {
      return;
    }
    this.#lastReading = reading;
    this.#viewport.resize({ cssWidth, cssHeight, devicePixelRatio, insets });
    const { width, height } = this.#viewport.deviceSize;
    if (this.#canvas.width !== width || this.#canvas.height !== height) {
      this.#canvas.width = width;
      this.#canvas.height = height;
    }
    this.#onResize();
  }

  /**
   * The screen to lay the game out for: the canvas as the page sizes it, or, held, the window's size settled by the
   * hold, which the canvas is then given.
   * @returns {import("./BarsHold.js").ScreenReading}
   */
  #measure() {
    const insets = this.#insets();
    if (this.#hold?.active !== true) {
      this.#pin(null);
      const measured = { cssWidth: this.#canvas.clientWidth, cssHeight: this.#canvas.clientHeight, insets };
      return this.#hold?.settle(measured) ?? measured;
    }
    const settled = this.#hold.settle({ cssWidth: this.#window.innerWidth, cssHeight: this.#window.innerHeight, insets });
    this.#pin(settled);
    return settled;
  }

  /**
   * Gives the canvas the held size (it then reaches past the page while the bars are shown: they cover that edge), or
   * back to the page's.
   * @param {{ cssWidth: number, cssHeight: number } | null} size
   */
  #pin(size) {
    if (size === null && !this.#pinned) {
      return;
    }
    this.#canvas.style.width = size === null ? "" : `${size.cssWidth}px`;
    this.#canvas.style.height = size === null ? "" : `${size.cssHeight}px`;
    this.#pinned = size !== null;
  }

  /** Canvas position in the page, for pointer coordinate conversion. */
  boundingRect() {
    return this.#canvas.getBoundingClientRect();
  }

  /**
   * The canvas box and the observed elements, as the browser lays them out.
   * @param {() => void} handler
   * @returns {() => void} stops observing
   */
  #observeBoxes(handler) {
    const Observer = this.#window.ResizeObserver;
    if (typeof Observer !== "function") {
      return () => undefined;
    }
    const observer = new Observer(handler);
    for (const element of [this.#canvas, ...this.#observed]) {
      observer.observe(element);
    }
    return () => observer.disconnect();
  }

  /**
   * The pixel density: a media query that matches the current one stops matching when it changes, and is then
   * asked again for the new one.
   * @param {() => void} handler
   * @returns {() => void} stops watching
   */
  #watchDensity(handler) {
    if (typeof this.#window.matchMedia !== "function") {
      return () => undefined;
    }
    const matchMedia = this.#window.matchMedia.bind(this.#window);
    /** @type {MediaQueryList | null} */
    let query = null;
    const onChange = () => {
      handler();
      arm();
    };
    const arm = () => {
      query?.removeEventListener("change", onChange);
      query = matchMedia(`(resolution: ${this.#window.devicePixelRatio || 1}dppx)`);
      query.addEventListener("change", onChange);
    };
    arm();
    return () => query?.removeEventListener("change", onChange);
  }
}
