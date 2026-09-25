/**
 * Trades for the screens (docs/tcg/13-scambi.md): the player's offers and
 * the ones made to them, and the actions on them. The server holds the
 * copies in escrow and swaps them; here nothing is decided, only asked.
 * Anything that moves copies reloads the collection too.
 */
/**
 * @typedef {Readonly<{ loading: boolean, busy: boolean, trades: readonly import("../ports/TradingApi.contract.js").Trade[], error: string | null, notice: string | null }>} TradingState
 */

const INITIAL = Object.freeze({ loading: false, busy: false, trades: Object.freeze([]), error: null, notice: null });
const ACTION_NOTICES = Object.freeze({ accept: "Trade done: the cards are in your collection.", decline: "Offer declined.", cancel: "Offer cancelled: your cards are back." });

export class TradingService {
  #api;
  #newKey;
  #onCollectionChanged;
  /** @type {TradingState} */
  #state = INITIAL;
  /** @type {Set<(state: TradingState) => void>} */
  #listeners = new Set();
  #generation = 0;

  /**
   * @param {{ api: import("../ports/TradingApi.contract.js").TradingApi, newKey: () => string, onCollectionChanged?: () => void }} deps
   */
  constructor({ api, newKey, onCollectionChanged = () => undefined }) {
    this.#api = api;
    this.#newKey = newKey;
    this.#onCollectionChanged = onCollectionChanged;
  }

  get state() {
    return this.#state;
  }

  /** @param {(state: TradingState) => void} listener */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async refresh() {
    const generation = this.#generation;
    this.#set({ loading: true });
    const listed = await this.#api.list();
    if (generation !== this.#generation) {
      return;
    }
    this.#set(listed.ok ? { loading: false, trades: listed.value, error: null } : { loading: false, error: listed.error.message });
  }

  /**
   * Offers copies (and asks for cards) to another player; the copies go into escrow on the server.
   * @param {{ to: string, give: readonly string[], want: readonly { definitionId: string, count: number }[] }} offer
   */
  async propose({ to, give, want }) {
    const result = await this.#run(() => this.#api.propose({ to: to.trim().toLowerCase(), give, want, idempotencyKey: this.#newKey() }), `Offer sent to @${to.trim().toLowerCase()}: your cards are held until it is answered.`);
    return result.ok;
  }

  /** @param {string} tradeId */
  accept(tradeId) {
    return this.#run(() => this.#api.accept(tradeId), ACTION_NOTICES.accept);
  }

  /** @param {string} tradeId */
  decline(tradeId) {
    return this.#run(() => this.#api.decline(tradeId), ACTION_NOTICES.decline);
  }

  /** @param {string} tradeId */
  cancel(tradeId) {
    return this.#run(() => this.#api.cancel(tradeId), ACTION_NOTICES.cancel);
  }

  /** Forgets everything (sign-out, account change). */
  reset() {
    this.#generation += 1;
    this.#set(INITIAL);
  }

  /**
   * @param {() => Promise<import("../ports/TradingApi.contract.js").TradeResult>} action
   * @param {string} notice
   */
  async #run(action, notice) {
    const generation = this.#generation;
    this.#set({ busy: true, error: null, notice: null });
    const result = await action();
    if (generation !== this.#generation) {
      return result;
    }
    if (!result.ok) {
      this.#set({ busy: false, error: result.error.message });
      return result;
    }
    const others = this.#state.trades.filter((trade) => trade.id !== result.value.id);
    this.#set({ busy: false, trades: Object.freeze([result.value, ...others]), notice });
    this.#onCollectionChanged();
    return result;
  }

  /** @param {Partial<TradingState>} changes */
  #set(changes) {
    this.#state = Object.freeze({ ...this.#state, ...changes });
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}
