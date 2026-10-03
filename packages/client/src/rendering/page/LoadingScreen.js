/**
 * The loading screen: an HTML veil over the canvas (markup and style in
 * index.html, id "loading"). The page shows it before any script runs, while
 * the game's modules download, its bar creeping on its own; from then on the
 * game moves the bar as what it waits for arrives, and lifts the veil once
 * the first screen is ready to be seen. The bar only ever moves forward.
 */

/** Where the bar stands once the game's scripts run: the page's own creep covered the download before. */
const SCRIPTS_LOADED = 0.3;
/** Where the bar waits until finish(): full only when the veil lifts. */
const BEFORE_FINISH = 0.96;
/** How long the full bar is seen before the veil fades. */
const FULL_BAR_MS = 250;
/** How long the fade lasts (the transition on .loading.is-leaving, in index.html), before the veil is removed. */
const FADE_MS = 800;

export class LoadingScreen {
  /** @type {HTMLElement | null} */
  #element;
  /** @type {Element | null} */
  #status;
  #timers;
  #shown = 0;
  #tracked = 0;
  #settled = 0;
  #finished = false;

  /**
   * @param {Pick<Document, "getElementById">} page
   * @param {{ setTimeout: (callback: () => void, ms: number) => unknown }} timers
   */
  constructor(page, timers) {
    this.#element = page.getElementById("loading");
    this.#status = this.#element?.querySelector(".loading-status") ?? null;
    this.#timers = timers;
    // The bar is the game's now: the page's creep stops where the scripts take over.
    this.#element?.setAttribute("data-live", "");
    this.#show(SCRIPTS_LOADED);
  }

  /**
   * What the game is doing, under the bar.
   * @param {string} text
   */
  say(text) {
    if (this.#status !== null && !this.#finished) {
      this.#status.textContent = text;
    }
  }

  /**
   * Counts a task the first screen waits for: the bar moves as each one settles, failed or not.
   * @template T
   * @param {Promise<T>} task
   * @returns {Promise<T>} the same task
   */
  track(task) {
    this.#tracked += 1;
    const settle = () => {
      this.#settled += 1;
      this.#show(SCRIPTS_LOADED + (BEFORE_FINISH - SCRIPTS_LOADED) * (this.#settled / this.#tracked));
    };
    task.then(settle, settle);
    return task;
  }

  /** Fills the bar and lifts the veil; once only. */
  finish() {
    if (this.#finished) {
      return;
    }
    this.#show(1);
    this.#finished = true;
    const element = this.#element;
    if (element === null) {
      return;
    }
    element.setAttribute("aria-busy", "false");
    this.#timers.setTimeout(() => {
      element.classList.add("is-leaving");
      this.#timers.setTimeout(() => element.remove(), FADE_MS);
    }, FULL_BAR_MS);
  }

  /** @param {number} fraction */
  #show(fraction) {
    if (this.#finished || fraction <= this.#shown) {
      return;
    }
    this.#shown = Math.min(1, fraction);
    this.#element?.style.setProperty("--loading-progress", this.#shown.toFixed(3));
    this.#element?.setAttribute("aria-valuenow", String(Math.round(this.#shown * 100)));
  }
}
