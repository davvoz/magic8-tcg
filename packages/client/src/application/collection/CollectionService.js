/**
 * What the signed-in player owns, as the server says: the starter offer
 * (until it is claimed) and the owned copies. The deck builder asks it how
 * many copies of each card may go into a deck; while nobody is signed in
 * there is no limit (offline practice uses the whole catalog).
 *
 * States: signed-out → loading → ready | failed.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";

export const CollectionStatus = Object.freeze({
  SIGNED_OUT: "signed-out",
  LOADING: "loading",
  READY: "ready",
  FAILED: "failed",
});

export const CollectionError = Object.freeze({
  NOT_READY: "COLLECTION_NOT_READY",
  BUSY: "BUSY",
});

/**
 * @typedef {Readonly<{
 *   status: string,
 *   starter: import("../ports/CollectionApi.contract.js").StarterStatus | null,
 *   cards: readonly import("../ports/CollectionApi.contract.js").CollectionEntry[],
 *   error: Readonly<{ code: string, message: string }> | null,
 * }>} CollectionState
 */

const EMPTY = Object.freeze({ status: CollectionStatus.SIGNED_OUT, starter: null, cards: Object.freeze([]), error: null });

export class CollectionService {
  #api;
  /** @type {CollectionState} */
  #state = EMPTY;
  /** @type {ReadonlyMap<string, number>} */
  #owned = new Map();
  /** @type {Set<(state: CollectionState) => void>} */
  #listeners = new Set();
  #claiming = false;
  /** Increases on every reset, so a slow refresh for a previous account is ignored. */
  #generation = 0;

  /** @param {{ api: import("../ports/CollectionApi.contract.js").CollectionApi }} deps */
  constructor({ api }) {
    this.#api = api;
  }

  get state() {
    return this.#state;
  }

  /**
   * @param {(state: CollectionState) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Copies that may go into a deck, per card; null while signed out (no limit).
   * @returns {ReadonlyMap<string, number> | null}
   */
  ownedCounts() {
    return this.#state.status === CollectionStatus.SIGNED_OUT ? null : this.#owned;
  }

  /** True once a signed-in player has cards or has taken the starter. */
  get hasStarter() {
    return this.#state.starter?.claimed === true;
  }

  /** Loads the starter offer and the collection. */
  async refresh() {
    const generation = this.#generation;
    this.#set({ ...this.#state, status: CollectionStatus.LOADING, error: null });
    const [starter, cards] = await Promise.all([this.#api.starter(), this.#api.collection()]);
    if (generation !== this.#generation) {
      return ok(this.#state);
    }
    if (!starter.ok || !cards.ok) {
      const error = starter.ok ? /** @type {import("@magic8/engine/shared/Result.js").Fail} */ (cards).error : starter.error;
      this.#set({ ...this.#state, status: CollectionStatus.FAILED, error });
      return fail(error.code, error.message);
    }
    this.#owned = activeCounts(cards.value);
    this.#set({ status: CollectionStatus.READY, starter: starter.value, cards: cards.value, error: null });
    return ok(this.#state);
  }

  /**
   * Takes the free starter deck; on success the collection is reloaded.
   * @param {string} starterId
   */
  async claimStarter(starterId) {
    if (this.#state.status !== CollectionStatus.READY) {
      return fail(CollectionError.NOT_READY, "the collection is not loaded yet");
    }
    if (this.#claiming) {
      return fail(CollectionError.BUSY, "a claim is already in progress");
    }
    this.#claiming = true;
    try {
      const claimed = await this.#api.claimStarter(starterId);
      if (!claimed.ok) {
        return claimed;
      }
      await this.refresh();
      return claimed;
    } finally {
      this.#claiming = false;
    }
  }

  /** Forgets the previous player's collection (sign-out, account switch). */
  reset() {
    this.#generation += 1;
    this.#owned = new Map();
    this.#set(EMPTY);
  }

  /** @param {CollectionState} state */
  #set(state) {
    this.#state = Object.freeze(state);
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}

/**
 * @param {readonly import("../ports/CollectionApi.contract.js").CollectionEntry[]} cards
 * @returns {ReadonlyMap<string, number>}
 */
function activeCounts(cards) {
  return new Map(cards.map((entry) => [entry.definitionId, entry.copies.filter((copy) => copy.status === "active").length]));
}
