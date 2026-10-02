/**
 * The signed-in player's budget: what their wallet holds on the chain, read
 * through the game server when a screen where they buy opens and after a
 * payment, and forgotten when they sign out. A budget to show, not a
 * guarantee: Keychain and the chain still decide whether a transfer goes
 * through.
 */
import { compareAmounts } from "../shop/shopCatalog.js";

/**
 * @typedef {Readonly<{ loading: boolean, balances: readonly import("../ports/BalanceApi.contract.js").Balance[] | null, error: string | null }>} BalanceState
 *   `balances` null until read (or when the read failed and nothing was known before)
 */

const INITIAL = Object.freeze({ loading: false, balances: null, error: null });

export class BalanceService {
  #api;
  /** @type {BalanceState} */
  #state = INITIAL;
  /** @type {Set<(state: BalanceState) => void>} */
  #listeners = new Set();
  /** Bumped by every read and by reset: only the latest read's answer is kept. */
  #generation = 0;

  /** @param {{ api: import("../ports/BalanceApi.contract.js").BalanceApi }} deps */
  constructor({ api }) {
    this.#api = api;
  }

  get state() {
    return this.#state;
  }

  /**
   * @param {(state: BalanceState) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Reads the wallet again; what was known stays shown while the read is on its way, and if it fails. */
  async refresh() {
    this.#generation += 1;
    const generation = this.#generation;
    this.#set({ loading: true, error: null });
    const result = await this.#api.balances();
    if (generation !== this.#generation) {
      return;
    }
    this.#set(result.ok ? { loading: false, balances: result.value, error: null } : { loading: false, error: result.error.message });
  }

  /** Forgets everything (sign-out, account change). */
  reset() {
    this.#generation += 1;
    this.#set(INITIAL);
  }

  /**
   * @param {string} asset e.g. "STEEM"
   * @returns {string | null} what the wallet holds of it, e.g. "12.500"; null while unknown
   */
  amountOf(asset) {
    return this.#state.balances?.find((balance) => balance.asset === asset)?.amount ?? null;
  }

  /**
   * Whether the wallet is known to hold less than `amount` of `asset`; false while unknown.
   * @param {string} amount
   * @param {string} asset
   */
  isShort(amount, asset) {
    const held = this.amountOf(asset);
    return held !== null && compareAmounts(held, amount) < 0;
  }

  /** @param {Partial<BalanceState>} changes */
  #set(changes) {
    this.#state = Object.freeze({ ...this.#state, ...changes });
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}
