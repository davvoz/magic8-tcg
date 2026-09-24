/**
 * Keeps what the client knows about the player's account in step with who
 * is signed in. On sign-in (or a restored session) it loads the collection
 * and the account's decks; on sign-out or an account switch it forgets them
 * and drops any deck left open in the builder, so one player's cards and
 * drafts never show up under another.
 *
 * States: signed-out → loading → ready | failed. Screens subscribe to redraw.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { IdentityStatus } from "../identity/IdentityService.js";

export const AccountStatus = Object.freeze({
  SIGNED_OUT: "signed-out",
  LOADING: "loading",
  READY: "ready",
  FAILED: "failed",
});

export const AccountError = Object.freeze({
  SIGNED_OUT: "SIGNED_OUT",
  UNAVAILABLE: "ACCOUNT_UNAVAILABLE",
});

/**
 * The account's decks as this service needs them: reload from the server,
 * forget on sign-out. Implemented by RemoteDeckRepository.
 * @typedef {object} AccountDecks
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Result<unknown>>} refresh
 * @property {() => void} clear
 */

/**
 * @typedef {Readonly<{ status: string, account: string | null, error: Readonly<{ code: string, message: string }> | null }>} AccountState
 */

const SIGNED_OUT = Object.freeze({ status: AccountStatus.SIGNED_OUT, account: null, error: null });

export class AccountService {
  #identity;
  #collection;
  #decks;
  #deckBuilding;
  #logger;
  /** @type {AccountState} */
  #state = SIGNED_OUT;
  /** Id of the user whose data is loaded (or loading); null while signed out. @type {string | null} */
  #userId = null;
  /** Increases on every account change, so a slow load for a previous account is ignored. */
  #generation = 0;
  /** @type {Set<(state: AccountState) => void>} */
  #listeners = new Set();

  /**
   * @param {{
   *   identity: import("../identity/IdentityService.js").IdentityService,
   *   collection: import("../collection/CollectionService.js").CollectionService,
   *   decks: AccountDecks,
   *   deckBuilding: { discard: () => void },
   *   logger: import("../ports/Logger.contract.js").Logger,
   * }} deps
   */
  constructor({ identity, collection, decks, deckBuilding, logger }) {
    this.#identity = identity;
    this.#collection = collection;
    this.#decks = decks;
    this.#deckBuilding = deckBuilding;
    this.#logger = logger;
  }

  get state() {
    return this.#state;
  }

  get collection() {
    return this.#collection;
  }

  /** Signed in, loaded, and the free starter deck not taken yet. */
  get needsStarter() {
    return this.#state.status === AccountStatus.READY && this.#collection.state.starter?.claimed === false;
  }

  /**
   * @param {(state: AccountState) => void} listener
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Follows the identity from now on, starting from its current state.
   * @returns {() => void} stop following
   */
  start() {
    const unsubscribe = this.#identity.subscribe((state) => this.#follow(state));
    this.#follow(this.#identity.state);
    return unsubscribe;
  }

  /** Reloads the collection and the decks of the signed-in player. */
  async refresh() {
    if (this.#userId === null) {
      return fail(AccountError.SIGNED_OUT, "sign in to load your collection");
    }
    const generation = this.#generation;
    this.#set({ ...this.#state, status: AccountStatus.LOADING, error: null });
    const [collection, decks] = await Promise.all([this.#collection.refresh(), this.#decks.refresh()]);
    if (generation !== this.#generation) {
      return ok(this.#state);
    }
    const failure = [collection, decks].find((result) => !result.ok);
    if (failure !== undefined && !failure.ok) {
      this.#logger.warn("account could not be loaded", failure.error);
      this.#set({ ...this.#state, status: AccountStatus.FAILED, error: failure.error });
      return failure;
    }
    this.#set({ ...this.#state, status: AccountStatus.READY, error: null });
    return ok(this.#state);
  }

  /**
   * Takes the free starter deck, then reloads the account: the server adds
   * the cards to the collection and saves them as a deck.
   * @param {string} starterId
   */
  async claimStarter(starterId) {
    const claimed = await this.#collection.claimStarter(starterId);
    if (!claimed.ok) {
      return claimed;
    }
    const reloaded = await this.refresh();
    if (!reloaded.ok) {
      this.#logger.warn("starter claimed, but the account did not reload", reloaded.error);
    }
    return claimed;
  }

  /** @param {import("../identity/IdentityService.js").IdentityState} identity */
  #follow(identity) {
    const user = identity.status === IdentityStatus.SIGNED_IN ? identity.user : null;
    if ((user?.id ?? null) === this.#userId) {
      return;
    }
    this.#generation += 1;
    this.#userId = user?.id ?? null;
    this.#deckBuilding.discard();
    this.#collection.reset();
    this.#decks.clear();
    if (user === null) {
      this.#set(SIGNED_OUT);
      return;
    }
    this.#set({ status: AccountStatus.LOADING, account: user.account, error: null });
    this.refresh().catch((error) => {
      this.#logger.error("account refresh failed", error);
      this.#set({ ...this.#state, status: AccountStatus.FAILED, error: { code: AccountError.UNAVAILABLE, message: "your account could not be loaded" } });
    });
  }

  /** @param {AccountState} state */
  #set(state) {
    this.#state = Object.freeze({ ...state, error: state.error === null ? null : Object.freeze({ code: state.error.code, message: state.error.message }) });
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}
