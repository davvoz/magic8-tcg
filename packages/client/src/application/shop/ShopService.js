/**
 * The shop, as a use case the screen drives: the listing, and one purchase
 * at a time from order to cards.
 *
 *   ordering    the server prices the order and issues payment instructions
 *   signing     the wallet asks the player to approve exactly that transfer
 *   confirming  the server watches the chain; we poll the order until it is
 *               fulfilled (about a minute: STEEM irreversibility)
 *   done        the cards arrived; the account (collection, decks) reloads
 *   failed      something refused; an order that can still be paid can be
 *               paid again or cancelled
 *
 * The client never computes an amount or a recipient: it forwards the
 * server's instructions to the wallet unchanged.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { OrderStatus } from "../ports/MarketApi.contract.js";

export const ShopStatus = Object.freeze({ IDLE: "idle", LOADING: "loading", READY: "ready", FAILED: "failed" });
export const PurchaseStage = Object.freeze({ NONE: "none", ORDERING: "ordering", SIGNING: "signing", CONFIRMING: "confirming", DONE: "done", FAILED: "failed" });
/**
 * Stages while a purchase is in flight.
 * @type {readonly string[]}
 */
export const BUSY_STAGES = Object.freeze([PurchaseStage.ORDERING, PurchaseStage.SIGNING, PurchaseStage.CONFIRMING]);
export const ShopError = Object.freeze({ BUSY: "BUSY", SIGNED_OUT: "SIGNED_OUT", NOT_READY: "SHOP_NOT_READY", STILL_WAITING: "STILL_WAITING", ORDER_CLOSED: "ORDER_CLOSED" });

/** @type {readonly string[]} */
const TERMINAL = Object.freeze([OrderStatus.FAILED, OrderStatus.EXPIRED, OrderStatus.CANCELLED]);

/**
 * @typedef {Readonly<{ stage: string, order: import("../ports/MarketApi.contract.js").Order | null, txId: string | null, error: Readonly<{ code: string, message: string }> | null }>} Purchase
 * @typedef {Readonly<{ status: string, listing: import("../ports/MarketApi.contract.js").Listing | null, error: Readonly<{ code: string, message: string }> | null, purchase: Purchase }>} ShopState
 */

const NO_PURCHASE = Object.freeze({ stage: PurchaseStage.NONE, order: null, txId: null, error: null });

export class ShopService {
  #api;
  #wallet;
  #account;
  #scheduler;
  #newKey;
  #pollIntervalMs;
  #maxPolls;
  /** @type {ShopState} */
  #state = Object.freeze({ status: ShopStatus.IDLE, listing: null, error: null, purchase: NO_PURCHASE });
  /** @type {Set<(state: ShopState) => void>} */
  #listeners = new Set();
  /** Increases when the purchase is reset, so a poll for a dismissed purchase stops. */
  #generation = 0;

  /**
   * @param {{
   *   api: import("../ports/MarketApi.contract.js").MarketApi,
   *   wallet: import("../ports/WalletConnector.contract.js").WalletConnector,
   *   account: { state: { account: string | null }, refresh: () => Promise<unknown> },
   *   scheduler: import("../ports/Scheduler.contract.js").Scheduler,
   *   newKey: () => string,
   *   pollIntervalMs?: number,
   *   maxPolls?: number,
   * }} deps `newKey` gives a fresh Idempotency-Key per purchase
   */
  constructor({ api, wallet, account, scheduler, newKey, pollIntervalMs = 3000, maxPolls = 120 }) {
    this.#api = api;
    this.#wallet = wallet;
    this.#account = account;
    this.#scheduler = scheduler;
    this.#newKey = newKey;
    this.#pollIntervalMs = pollIntervalMs;
    this.#maxPolls = maxPolls;
  }

  get state() {
    return this.#state;
  }

  get walletName() {
    return this.#wallet.name;
  }

  /**
   * @param {(state: ShopState) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Loads what is on sale (public: works signed out too). */
  async load() {
    this.#set({ status: ShopStatus.LOADING, error: null });
    const listing = await this.#api.listing();
    this.#set(listing.ok ? { status: ShopStatus.READY, listing: listing.value, error: null } : { status: ShopStatus.FAILED, error: listing.error });
    return listing;
  }

  /**
   * @param {{ productId: string, quantity: number, asset: string }} request
   */
  async buy(request) {
    const refused = this.#refuseToStart();
    if (refused !== null) {
      return refused;
    }
    this.#setPurchase({ stage: PurchaseStage.ORDERING, order: null, txId: null, error: null });
    const created = await this.#api.createOrder(request, this.#newKey());
    if (!created.ok) {
      this.#setPurchase({ ...this.#state.purchase, stage: PurchaseStage.FAILED, error: created.error });
      return created;
    }
    return this.#payOrder(created.value);
  }

  /** Pays the current order again (after the wallet refused, for instance). */
  async payAgain() {
    const order = this.#state.purchase.order;
    if (order === null || order.payment === null || this.#busy()) {
      return fail(ShopError.ORDER_CLOSED, "this order can no longer be paid");
    }
    return this.#payOrder(order);
  }

  /** Cancels the current order, while it is unpaid. */
  async cancel() {
    const order = this.#state.purchase.order;
    if (order === null) {
      return fail(ShopError.ORDER_CLOSED, "there is no order to cancel");
    }
    const cancelled = await this.#api.cancelOrder(order.id);
    if (cancelled.ok) {
      this.dismiss();
    }
    return cancelled;
  }

  /** Forgets the finished (or abandoned) purchase and stops polling it. */
  dismiss() {
    this.#generation += 1;
    this.#setPurchase(NO_PURCHASE);
  }

  /** @param {import("../ports/MarketApi.contract.js").Order} order */
  async #payOrder(order) {
    const instructions = /** @type {import("../ports/MarketApi.contract.js").PaymentInstructions} */ (order.payment);
    this.#setPurchase({ stage: PurchaseStage.SIGNING, order, txId: null, error: null });
    const paid = await this.#wallet.requestTransfer({ from: instructions.from, to: instructions.to, amount: instructions.amount, asset: instructions.asset, memo: instructions.memo });
    if (!paid.ok) {
      this.#setPurchase({ ...this.#state.purchase, stage: PurchaseStage.FAILED, error: paid.error });
      return paid;
    }
    this.#setPurchase({ ...this.#state.purchase, stage: PurchaseStage.CONFIRMING, txId: paid.value });
    const hinted = await this.#api.paymentHint(order.id, paid.value);
    if (hinted.ok) {
      this.#setPurchase({ ...this.#state.purchase, order: hinted.value });
    }
    return this.#waitForCards(order.id);
  }

  /** @param {string} orderId */
  async #waitForCards(orderId) {
    const generation = this.#generation;
    for (let poll = 0; poll < this.#maxPolls; poll += 1) {
      const current = await this.#api.getOrder(orderId);
      if (generation !== this.#generation) {
        return fail(ShopError.ORDER_CLOSED, "the purchase was dismissed");
      }
      if (current.ok) {
        this.#setPurchase({ ...this.#state.purchase, order: current.value });
        if (current.value.status === OrderStatus.FULFILLED) {
          this.#setPurchase({ ...this.#state.purchase, stage: PurchaseStage.DONE });
          await this.#account.refresh();
          return ok(current.value);
        }
        if (TERMINAL.includes(current.value.status)) {
          const error = { code: current.value.status, message: `the order is ${current.value.status.toLowerCase()}` };
          this.#setPurchase({ ...this.#state.purchase, stage: PurchaseStage.FAILED, error });
          return fail(error.code, error.message);
        }
      }
      await this.#scheduler.delay(this.#pollIntervalMs);
    }
    const error = { code: ShopError.STILL_WAITING, message: "the payment is taking longer than usual; your cards will arrive when the chain confirms it" };
    this.#setPurchase({ ...this.#state.purchase, error });
    return fail(error.code, error.message);
  }

  #busy() {
    return BUSY_STAGES.includes(this.#state.purchase.stage);
  }

  /** @returns {import("@magic8/engine/shared/Result.js").Fail | null} */
  #refuseToStart() {
    if (this.#account.state.account === null) {
      return fail(ShopError.SIGNED_OUT, "sign in to buy");
    }
    if (this.#state.status !== ShopStatus.READY) {
      return fail(ShopError.NOT_READY, "the shop is not loaded");
    }
    return this.#busy() ? fail(ShopError.BUSY, "a purchase is already in progress") : null;
  }

  /** @param {Partial<Purchase>} purchase */
  #setPurchase(purchase) {
    this.#set({ purchase: Object.freeze({ ...NO_PURCHASE, ...purchase, error: purchase.error ? Object.freeze({ code: purchase.error.code, message: purchase.error.message }) : null }) });
  }

  /** @param {Partial<ShopState>} changes */
  #set(changes) {
    this.#state = Object.freeze({ ...this.#state, ...changes });
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}
