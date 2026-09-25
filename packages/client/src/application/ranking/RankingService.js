/**
 * Ranked standing and leaderboard for the screens: loaded on demand,
 * refreshed after a ranked game, and reset when the player signs out.
 */
/**
 * @typedef {Readonly<{ loading: boolean, standing: import("../ports/RankingApi.contract.js").Standing | null, leaderboard: import("../ports/RankingApi.contract.js").Leaderboard | null, error: string | null }>} RankingState
 */

const INITIAL = Object.freeze({ loading: false, standing: null, leaderboard: null, error: null });

export class RankingService {
  #api;
  /** @type {RankingState} */
  #state = INITIAL;
  /** @type {Set<(state: RankingState) => void>} */
  #listeners = new Set();
  #generation = 0;

  /** @param {{ api: import("../ports/RankingApi.contract.js").RankingApi }} deps */
  constructor({ api }) {
    this.#api = api;
  }

  get state() {
    return this.#state;
  }

  /**
   * @param {(state: RankingState) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Loads the player's standing and the leaderboard; answers that arrive after a reset are dropped. */
  async refresh() {
    const generation = this.#generation;
    this.#set({ loading: true, error: null });
    const [standing, leaderboard] = await Promise.all([this.#api.standing(), this.#api.leaderboard()]);
    if (generation !== this.#generation) {
      return;
    }
    const failed = [standing, leaderboard].find((result) => !result.ok);
    this.#set({
      loading: false,
      standing: standing.ok ? standing.value : this.#state.standing,
      leaderboard: leaderboard.ok ? leaderboard.value : this.#state.leaderboard,
      error: failed === undefined ? null : /** @type {any} */ (failed).error.message,
    });
  }

  /** Forgets everything (sign-out, account change). */
  reset() {
    this.#generation += 1;
    this.#set(INITIAL);
  }

  /** @param {Partial<RankingState>} changes */
  #set(changes) {
    this.#state = Object.freeze({ ...this.#state, ...changes });
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}
