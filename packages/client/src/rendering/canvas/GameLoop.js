/**
 * requestAnimationFrame loop with a dirty flag: `update(dt)` runs every
 * frame, `render()` only when something asked for it. A card game idles
 * most of the time; skipping redraws keeps it cheap on laptops.
 * Frame scheduling is injected so the loop is testable.
 */
const MAX_FRAME_MS = 100;

export class GameLoop {
  #requestFrame;
  #cancelFrame;
  #now;
  #handle = null;
  #last = 0;
  #dirty = true;
  #running = false;
  /** @type {{ update: (dtMs: number) => boolean, render: () => void, onError?: (error: unknown) => void } | null} */
  #target = null;

  /**
   * @param {{ requestFrame: (callback: (time: number) => void) => number, cancelFrame: (handle: number) => void, now: () => number }} deps
   */
  constructor({ requestFrame, cancelFrame, now }) {
    this.#requestFrame = requestFrame;
    this.#cancelFrame = cancelFrame;
    this.#now = now;
  }

  get isRunning() {
    return this.#running;
  }

  /** Asks for a render on the next frame. */
  requestRender() {
    this.#dirty = true;
  }

  /**
   * @param {{ update: (dtMs: number) => boolean, render: () => void, onError?: (error: unknown) => void }} target
   *   `update` returns true when a render is needed. If a frame throws, the
   *   loop stops and `onError` is told; without it the error propagates.
   */
  start(target) {
    if (this.#running) {
      return;
    }
    this.#target = target;
    this.#running = true;
    this.#last = this.#now();
    this.#dirty = true;
    this.#schedule();
  }

  stop() {
    this.#running = false;
    if (this.#handle !== null) {
      this.#cancelFrame(this.#handle);
      this.#handle = null;
    }
  }

  #schedule() {
    this.#handle = this.#requestFrame(() => this.#frame());
  }

  #frame() {
    if (!this.#running || this.#target === null) {
      return;
    }
    const current = this.#now();
    const dt = Math.min(MAX_FRAME_MS, Math.max(0, current - this.#last));
    this.#last = current;
    try {
      const needsRender = this.#target.update(dt);
      if (needsRender || this.#dirty) {
        this.#dirty = false;
        this.#target.render();
      }
    } catch (error) {
      this.stop();
      if (this.#target.onError === undefined) {
        throw error;
      }
      this.#target.onError(error);
      return;
    }
    this.#schedule();
  }
}
