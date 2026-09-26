/**
 * The player market for the screens (docs/tcg/14-vendite.md): the public
 * board, the player's own listings and purchases, selling a copy, and one
 * purchase at a time from reservation to card.
 *
 *   reserving   the server holds the listing for the buyer and issues the
 *               payment instructions (to the seller's own account)
 *   signing     the wallet asks the player to approve exactly that transfer
 *   confirming  the server watches the seller's history; we poll the
 *               purchase until it completes (about a minute: irreversibility)
 *   done        the card is in the collection, which reloads
 *   failed      something refused; an unpaid purchase can be paid again or
 *               released (never automatically: a wallet that timed out may
 *               still send the transfer)
 *
 * The client never computes an amount or a recipient: it forwards the
 * server's instructions to the wallet unchanged.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { SalePurchaseStatus } from "../ports/SalesApi.contract.js";

export const BuyStage = Object.freeze({ NONE: "none", RESERVING: "reserving", SIGNING: "signing", CONFIRMING: "confirming", DONE: "done", FAILED: "failed" });
/** @type {readonly string[]} */
export const BUSY_BUY_STAGES = Object.freeze([BuyStage.RESERVING, BuyStage.SIGNING, BuyStage.CONFIRMING]);
export const SalesError = Object.freeze({ BUSY: "BUSY", SIGNED_OUT: "SIGNED_OUT", STILL_WAITING: "STILL_WAITING", CLOSED: "PURCHASE_CLOSED" });

/** @type {readonly string[]} */
const TERMINAL = Object.freeze([SalePurchaseStatus.EXPIRED, SalePurchaseStatus.CANCELLED]);

/**
 * @typedef {import("../ports/SalesApi.contract.js").Listing} Listing
 * @typedef {import("../ports/SalesApi.contract.js").Purchase} Purchase
 * @typedef {Readonly<{ code: string, message: string }>} SalesFailure
 * @typedef {Readonly<{ stage: string, purchase: Purchase | null, error: SalesFailure | null }>} Buying
 * @typedef {Readonly<{ card: string | null, sort: "newest" | "cheapest", offset: number }>} BoardFilter
 * @typedef {Readonly<{
 *   loading: boolean, listings: readonly Listing[], total: number, pageSize: number, filter: BoardFilter,
 *   mine: Readonly<{ listings: readonly Listing[], purchases: readonly Purchase[] }>,
 *   busy: boolean, error: string | null, notice: string | null, buying: Buying,
 * }>} SalesState
 */

const NO_BUYING = Object.freeze({ stage: BuyStage.NONE, purchase: null, error: null });
const INITIAL = Object.freeze({
  loading: false,
  listings: Object.freeze([]),
  total: 0,
  pageSize: 50,
  filter: Object.freeze({ card: null, sort: /** @type {const} */ ("newest"), offset: 0 }),
  mine: Object.freeze({ listings: Object.freeze([]), purchases: Object.freeze([]) }),
  busy: false,
  error: null,
  notice: null,
  buying: NO_BUYING,
});

/** Why a transfer with the purchase's reference did not pay it, for the buyer. */
export const PROBLEM_TEXT = Object.freeze({
  WRONG_AMOUNT: "a transfer with this purchase's reference sent the wrong amount",
  WRONG_ASSET: "a transfer with this purchase's reference was not in the right currency",
  WRONG_SENDER: "a transfer with this purchase's reference came from another account",
  WRONG_RECEIVER: "a transfer with this purchase's reference went to another account",
  LATE: "a transfer with this purchase's reference arrived after the reservation ended",
});

export class SalesService {
  #api;
  #wallet;
  #account;
  #scheduler;
  #newKey;
  #asset;
  #onCollectionChanged;
  #pollIntervalMs;
  #maxPolls;
  /** @type {SalesState} */
  #state = INITIAL;
  /** @type {Set<(state: SalesState) => void>} */
  #listeners = new Set();
  /** Bumped by reset and dismiss, so answers for a forgotten account or purchase are dropped. */
  #generation = 0;
  /** Bumped by every board load, so only the latest one is kept. */
  #boardLoads = 0;

  /**
   * @param {{
   *   api: import("../ports/SalesApi.contract.js").SalesApi,
   *   wallet: import("../ports/WalletConnector.contract.js").WalletConnector,
   *   account: { state: { account: string | null } },
   *   scheduler: import("../ports/Scheduler.contract.js").Scheduler,
   *   newKey: () => string,
   *   asset?: string,
   *   onCollectionChanged?: () => void,
   *   pollIntervalMs?: number,
   *   maxPolls?: number,
   * }} deps `asset`: what prices are asked in
   */
  constructor({ api, wallet, account, scheduler, newKey, asset = "STEEM", onCollectionChanged = () => undefined, pollIntervalMs = 3000, maxPolls = 120 }) {
    this.#api = api;
    this.#wallet = wallet;
    this.#account = account;
    this.#scheduler = scheduler;
    this.#newKey = newKey;
    this.#asset = asset;
    this.#onCollectionChanged = onCollectionChanged;
    this.#pollIntervalMs = pollIntervalMs;
    this.#maxPolls = maxPolls;
  }

  get state() {
    return this.#state;
  }

  get asset() {
    return this.#asset;
  }

  get walletName() {
    return this.#wallet.name;
  }

  /** @param {(state: SalesState) => void} listener */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Loads a page of the board (public: works signed out too). Omitted fields keep the current filter.
   * @param {Partial<BoardFilter>} [filter]
   */
  async loadBoard(filter = {}) {
    const load = (this.#boardLoads += 1);
    const next = Object.freeze({ ...this.#state.filter, ...filter });
    this.#set({ loading: true, filter: next });
    const page = await this.#api.board({ card: next.card ?? undefined, sort: next.sort, offset: next.offset });
    if (load !== this.#boardLoads) {
      return;
    }
    this.#set(page.ok ? { loading: false, listings: page.value.listings, total: page.value.total, pageSize: page.value.pageSize, error: null } : { loading: false, error: page.error.message });
  }

  /** The player's own listings and purchases (signed in). */
  async refreshMine() {
    if (this.#account.state.account === null) {
      return;
    }
    const generation = this.#generation;
    const mine = await this.#api.mine();
    if (generation === this.#generation && mine.ok) {
      this.#set({ mine: mine.value });
    }
  }

  /** Board and own activity, e.g. when the server says a listing changed. */
  refresh() {
    return Promise.all([this.loadBoard(), this.refreshMine()]);
  }

  /**
   * Puts a copy on the board; the server holds it until it sells, is withdrawn or expires.
   * @param {{ copy: string, price: string }} request `price`: a decimal amount of the asset
   */
  async sell({ copy, price }) {
    const listed = await this.#act(() => this.#api.list({ copy, price: price.trim(), asset: this.#asset, idempotencyKey: this.#newKey() }), (listing) => `On the board for ${listing.price.amount} ${listing.price.asset}: the card is held until it sells.`);
    return listed.ok;
  }

  /** @param {string} listingId */
  withdraw(listingId) {
    return this.#act(() => this.#api.cancelListing(listingId), () => "Listing withdrawn: the card is back in your collection.");
  }

  /**
   * Reserves a listing, pays the seller through the wallet and waits for the card.
   * @param {string} listingId
   */
  async buy(listingId) {
    if (this.#account.state.account === null) {
      return fail(SalesError.SIGNED_OUT, "sign in to buy");
    }
    if (this.#buyingBusy()) {
      return fail(SalesError.BUSY, "a purchase is already in progress");
    }
    this.#setBuying({ stage: BuyStage.RESERVING, purchase: null, error: null });
    const reserved = await this.#api.buy(listingId);
    if (!reserved.ok) {
      this.#setBuying({ ...this.#state.buying, stage: BuyStage.FAILED, error: reserved.error });
      return reserved;
    }
    return this.#pay(reserved.value);
  }

  /** Pays the current purchase again (after the wallet refused, for instance). */
  async payAgain() {
    const purchase = this.#state.buying.purchase;
    if (purchase === null || purchase.payment === null || this.#buyingBusy()) {
      return fail(SalesError.CLOSED, "this purchase can no longer be paid");
    }
    return this.#pay(purchase);
  }

  /** Gives up the current purchase while it is unpaid; the listing is free for others again. */
  async release() {
    const purchase = this.#state.buying.purchase;
    if (purchase === null) {
      return fail(SalesError.CLOSED, "there is no purchase to release");
    }
    const released = await this.#api.release(purchase.id);
    if (released.ok) {
      this.dismiss();
      this.refresh();
    } else {
      this.#setBuying({ ...this.#state.buying, error: released.error });
    }
    return released;
  }

  /** Forgets the finished (or abandoned) purchase and stops polling it. */
  dismiss() {
    this.#generation += 1;
    this.#setBuying(NO_BUYING);
  }

  /** Forgets everything (sign-out, account change). */
  reset() {
    this.#generation += 1;
    this.#boardLoads += 1;
    this.#set(INITIAL);
  }

  /** @param {Purchase} purchase */
  async #pay(purchase) {
    const instructions = /** @type {import("../ports/SalesApi.contract.js").PaymentInstructions} */ (purchase.payment);
    this.#setBuying({ stage: BuyStage.SIGNING, purchase, error: null });
    const paid = await this.#wallet.requestTransfer({ from: instructions.from, to: instructions.to, amount: instructions.amount, asset: instructions.asset, memo: instructions.memo });
    if (!paid.ok) {
      this.#setBuying({ ...this.#state.buying, stage: BuyStage.FAILED, error: paid.error });
      return paid;
    }
    this.#setBuying({ ...this.#state.buying, stage: BuyStage.CONFIRMING });
    const hinted = await this.#api.paymentHint(purchase.id, paid.value);
    if (hinted.ok) {
      this.#setBuying({ ...this.#state.buying, purchase: hinted.value });
    }
    return this.#waitForCard(purchase.id);
  }

  /** @param {string} purchaseId */
  async #waitForCard(purchaseId) {
    const generation = this.#generation;
    for (let poll = 0; poll < this.#maxPolls; poll += 1) {
      const current = await this.#api.purchase(purchaseId);
      if (generation !== this.#generation) {
        return fail(SalesError.CLOSED, "the purchase was dismissed");
      }
      if (current.ok) {
        this.#setBuying({ ...this.#state.buying, purchase: current.value });
        if (current.value.status === SalePurchaseStatus.COMPLETED) {
          this.#setBuying({ ...this.#state.buying, stage: BuyStage.DONE });
          this.#onCollectionChanged();
          this.refresh();
          return ok(current.value);
        }
        if (TERMINAL.includes(current.value.status)) {
          const error = { code: current.value.status, message: `the purchase is ${current.value.status.toLowerCase()}` };
          this.#setBuying({ ...this.#state.buying, stage: BuyStage.FAILED, error });
          return fail(error.code, error.message);
        }
      }
      await this.#scheduler.delay(this.#pollIntervalMs);
    }
    const error = { code: SalesError.STILL_WAITING, message: "the payment is taking longer than usual; the card will arrive when the chain confirms it" };
    this.#setBuying({ ...this.#state.buying, error });
    return fail(error.code, error.message);
  }

  /**
   * Runs a listing action; on success the board, the player's activity and the collection reload.
   * @param {() => Promise<import("../ports/SalesApi.contract.js").ListingResult>} action
   * @param {(listing: Listing) => string} notice
   */
  async #act(action, notice) {
    const generation = this.#generation;
    this.#set({ busy: true, error: null, notice: null });
    const result = await action();
    if (generation !== this.#generation) {
      return result;
    }
    this.#set(result.ok ? { busy: false, notice: notice(result.value) } : { busy: false, error: result.error.message });
    if (result.ok) {
      this.#onCollectionChanged();
      this.refresh();
    }
    return result;
  }

  #buyingBusy() {
    return BUSY_BUY_STAGES.includes(this.#state.buying.stage);
  }

  /** @param {Partial<Buying>} buying */
  #setBuying(buying) {
    this.#set({ buying: Object.freeze({ ...NO_BUYING, ...buying, error: buying.error ? Object.freeze({ code: buying.error.code, message: buying.error.message }) : null }) });
  }

  /** @param {Partial<SalesState>} changes */
  #set(changes) {
    this.#state = Object.freeze({ ...this.#state, ...changes });
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}
