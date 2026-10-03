/**
 * The season's jackpot for the screens: read from the game server when a
 * screen that shows it opens, and again every minute while one does (the
 * jackpot follows the bank's wallet). Nothing here is the player's own: it
 * works signed out too.
 */
/**
 * @typedef {Readonly<{ loading: boolean, loaded: boolean, jackpot: import("../ports/JackpotApi.contract.js").Jackpot | null, error: string | null }>} JackpotState
 *   `jackpot` null until read, and when no season has one (`loaded` tells them apart)
 */

const INITIAL = Object.freeze({ loading: false, loaded: false, jackpot: null, error: null });
const DEFAULT_REFRESH_MS = 60_000;

export class JackpotService {
  #api;
  #scheduler;
  #now;
  #refreshMs;
  /** @type {JackpotState} */
  #state = INITIAL;
  /** @type {Set<(state: JackpotState) => void>} */
  #listeners = new Set();
  #watchers = 0;
  #polling = false;

  /**
   * @param {{ api: import("../ports/JackpotApi.contract.js").JackpotApi, scheduler: import("../ports/Scheduler.contract.js").Scheduler, now: () => number, refreshMs?: number }} deps
   */
  constructor({ api, scheduler, now, refreshMs = DEFAULT_REFRESH_MS }) {
    this.#api = api;
    this.#scheduler = scheduler;
    this.#now = now;
    this.#refreshMs = refreshMs;
  }

  get state() {
    return this.#state;
  }

  /** The time the countdown counts from. */
  now() {
    return this.#now();
  }

  /**
   * @param {(state: JackpotState) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * A screen shows the jackpot: it is read now, then every minute until the returned function is called.
   * @returns {() => void}
   */
  watch() {
    this.#watchers += 1;
    void this.refresh();
    if (!this.#polling) {
      void this.#poll();
    }
    let watching = true;
    return () => {
      if (watching) {
        watching = false;
        this.#watchers -= 1;
      }
    };
  }

  /** Reads the jackpot; what was known stays shown while the read is on its way, and if it fails. */
  async refresh() {
    this.#set({ loading: true });
    const result = await this.#api.current();
    this.#set(result.ok ? { loading: false, loaded: true, jackpot: result.value, error: null } : { loading: false, error: result.error.message });
  }

  async #poll() {
    this.#polling = true;
    try {
      while (this.#watchers > 0) {
        await this.#scheduler.delay(this.#refreshMs);
        if (this.#watchers > 0) {
          await this.refresh();
        }
      }
    } finally {
      this.#polling = false;
    }
  }

  /** @param {Partial<JackpotState>} changes */
  #set(changes) {
    this.#state = Object.freeze({ ...this.#state, ...changes });
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}
