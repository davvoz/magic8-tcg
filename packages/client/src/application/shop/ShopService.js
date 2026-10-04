/**
 * The shop, as a use case the screen drives: the listing, the cart, and one
 * purchase at a time from order to cards.
 *
 * A purchase is either one product bought at once (`buy`) or the whole cart
 * (`checkout`): the cart becomes one order, paid with one transfer. What was
 * ordered leaves the cart only once the wallet has sent the payment; an order
 * refused, abandoned or cancelled leaves the cart as it was. The cart belongs
 * to whoever is signed in: it empties when they sign out or someone else
 * signs in (a cart filled before signing in is kept).
 *
 *   ordering    the server prices the order and issues payment instructions
 *   signing     the wallet asks the player to approve exactly that transfer
 *   confirming  the server watches the chain; we poll the order until it is
 *               fulfilled (about a minute: STEEM irreversibility)
 *   done        the cards arrived; the account (collection, decks) reloads
 *   failed      something refused; an order that can still be paid can be
 *               paid again or cancelled
 *
 * The player's unpaid orders (`orders`) are kept too, read from the server:
 * those a refused or abandoned payment left behind, which count against the
 * server's limit of unpaid orders until paid, cancelled or expired. Each can
 * be paid or cancelled from there; the list is read again whenever an order
 * is made, refused, paid or cancelled.
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
export const ShopError = Object.freeze({ BUSY: "BUSY", SIGNED_OUT: "SIGNED_OUT", NOT_READY: "SHOP_NOT_READY", STILL_WAITING: "STILL_WAITING", ORDER_CLOSED: "ORDER_CLOSED", CART: "CART" });
export const OrdersStatus = Object.freeze({ IDLE: "idle", LOADING: "loading", READY: "ready", FAILED: "failed" });
/** Most different products in the cart (the server's lines per order). */
export const MAX_CART_LINES = 20;

/** @type {readonly string[]} */
const TERMINAL = Object.freeze([OrderStatus.FAILED, OrderStatus.EXPIRED, OrderStatus.CANCELLED]);
/** Orders still waiting for their payment. @type {readonly string[]} */
const UNPAID = Object.freeze([OrderStatus.CREATED, OrderStatus.PAYMENT_PENDING]);

/**
 * @typedef {Readonly<{ productId: string, quantity: number }>} CartLine
 * @typedef {Readonly<{ stage: string, order: import("../ports/MarketApi.contract.js").Order | null, txId: string | null, error: Readonly<{ code: string, message: string }> | null, cart: readonly CartLine[] | null }>} Purchase `cart`: the lines, when the purchase is the cart's
 * @typedef {Readonly<{ status: string, open: readonly import("../ports/MarketApi.contract.js").Order[], error: Readonly<{ code: string, message: string }> | null }>} UnpaidOrders `open`: newest first
 * @typedef {Readonly<{ status: string, listing: import("../ports/MarketApi.contract.js").Listing | null, error: Readonly<{ code: string, message: string }> | null, purchase: Purchase, cart: readonly CartLine[], orders: UnpaidOrders }>} ShopState
 */

const NO_PURCHASE = Object.freeze({ stage: PurchaseStage.NONE, order: null, txId: null, error: null, cart: null });
/** @type {readonly CartLine[]} */
const EMPTY_CART = Object.freeze([]);
/** @type {UnpaidOrders} */
const NO_ORDERS = Object.freeze({ status: OrdersStatus.IDLE, open: Object.freeze([]), error: null });

export class ShopService {
  #api;
  #wallet;
  #account;
  #scheduler;
  #newKey;
  #pollIntervalMs;
  #maxPolls;
  /** @type {ShopState} */
  #state = Object.freeze({ status: ShopStatus.IDLE, listing: null, error: null, purchase: NO_PURCHASE, cart: EMPTY_CART, orders: NO_ORDERS });
  /** @type {Set<(state: ShopState) => void>} */
  #listeners = new Set();
  /** Increases when the purchase is reset, so a poll for a dismissed purchase stops. */
  #generation = 0;
  /**
   * Orders whose payment the wallet sent: never offered again, though the
   * server shows them unpaid until the chain confirms (about a minute).
   * @type {Set<string>}
   */
  #sent = new Set();

  /**
   * @param {{
   *   api: import("../ports/MarketApi.contract.js").MarketApi,
   *   wallet: import("../ports/WalletConnector.contract.js").WalletConnector,
   *   account: { state: { account: string | null }, refresh: () => Promise<unknown>, subscribe?: (listener: (state: { account: string | null }) => void) => () => void },
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
    let owner = account.state.account;
    account.subscribe?.((state) => {
      if (owner !== null && state.account !== owner) {
        this.clearCart();
        this.#set({ orders: NO_ORDERS });
      }
      owner = state.account;
    });
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
   * Buys one product now, without the cart.
   * @param {{ productId: string, quantity: number, asset: string }} request
   */
  async buy({ productId, quantity, asset }) {
    const refused = this.#refuseToStart();
    if (refused !== null) {
      return refused;
    }
    this.#setPurchase({ stage: PurchaseStage.ORDERING });
    const created = await this.#api.createOrder({ items: [{ productId, quantity }], asset }, this.#newKey());
    if (!created.ok) {
      this.#setPurchase({ ...this.#state.purchase, stage: PurchaseStage.FAILED, error: created.error });
      void this.loadOrders();
      return created;
    }
    return this.#payOrder(created.value);
  }

  /**
   * Puts copies of a product in the cart (added to those already there), up
   * to the product's per-order limit.
   * @param {string} productId
   * @param {number} quantity
   */
  addToCart(productId, quantity) {
    const product = this.#product(productId);
    if (product === undefined) {
      return fail(ShopError.CART, "this product is not on sale");
    }
    const line = this.#state.cart.find((candidate) => candidate.productId === productId);
    if (line === undefined && this.#state.cart.length >= MAX_CART_LINES) {
      return fail(ShopError.CART, `the cart holds at most ${MAX_CART_LINES} different products: pay for it first`);
    }
    const wanted = (line?.quantity ?? 0) + quantity;
    this.#setCartQuantity(productId, Math.min(wanted, product.perOrder));
    return wanted > product.perOrder ? fail(ShopError.CART, `at most ${product.perOrder} of ${product.name} per order: the cart has ${product.perOrder}`) : ok(undefined);
  }

  /**
   * Changes how many copies of a product the cart holds; 0 takes it out.
   * @param {string} productId
   * @param {number} quantity
   */
  setCartQuantity(productId, quantity) {
    if (!this.#state.cart.some((line) => line.productId === productId)) {
      return;
    }
    const limit = this.#product(productId)?.perOrder ?? quantity;
    this.#setCartQuantity(productId, Math.max(0, Math.min(quantity, limit)));
  }

  /** @param {string} productId */
  removeFromCart(productId) {
    this.setCartQuantity(productId, 0);
  }

  clearCart() {
    if (this.#state.cart.length > 0) {
      this.#set({ cart: EMPTY_CART });
    }
  }

  /**
   * Buys the whole cart: one order, one transfer.
   * @param {string} asset the asset the cart is priced in
   */
  async checkout(asset) {
    const refused = this.#refuseToStart();
    if (refused !== null) {
      return refused;
    }
    const cart = this.#state.cart;
    if (cart.length === 0) {
      return fail(ShopError.CART, "the cart is empty");
    }
    this.#setPurchase({ stage: PurchaseStage.ORDERING, cart });
    const created = await this.#api.createOrder({ items: cart, asset }, this.#newKey());
    if (!created.ok) {
      this.#setPurchase({ ...this.#state.purchase, stage: PurchaseStage.FAILED, error: created.error });
      void this.loadOrders();
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
    void this.loadOrders();
    return cancelled;
  }

  /** Reads the player's unpaid orders again. */
  async loadOrders() {
    if (this.#account.state.account === null) {
      this.#set({ orders: NO_ORDERS });
      return ok(NO_ORDERS.open);
    }
    this.#set({ orders: Object.freeze({ ...this.#state.orders, status: OrdersStatus.LOADING }) });
    const listed = await this.#api.listOrders();
    if (!listed.ok) {
      this.#set({ orders: Object.freeze({ ...this.#state.orders, status: OrdersStatus.FAILED, error: listed.error }) });
      return listed;
    }
    const open = listed.value.filter((order) => UNPAID.includes(order.status) && order.payment !== null && !this.#sent.has(order.id)).sort((left, right) => right.createdAt - left.createdAt);
    this.#set({ orders: Object.freeze({ status: OrdersStatus.READY, open: Object.freeze(open), error: null }) });
    return ok(this.#state.orders.open);
  }

  /**
   * Pays one of the unpaid orders, as Pay again would; its progress shows as the purchase's.
   * @param {string} orderId
   */
  async payOpenOrder(orderId) {
    const refused = this.#refuseToStart();
    if (refused !== null) {
      return refused;
    }
    const order = this.#state.orders.open.find((candidate) => candidate.id === orderId);
    if (order === undefined || order.payment === null) {
      return fail(ShopError.ORDER_CLOSED, "this order can no longer be paid");
    }
    if (this.#state.purchase.order?.id !== orderId) {
      // Another order than the last purchase's: the cart's lines are not what it pays for.
      this.#setPurchase(NO_PURCHASE);
    }
    return this.#payOrder(order);
  }

  /**
   * Cancels one of the unpaid orders.
   * @param {string} orderId
   */
  async cancelOpenOrder(orderId) {
    if (this.#busy() && this.#state.purchase.order?.id === orderId) {
      return fail(ShopError.BUSY, "this order is being paid");
    }
    const cancelled = await this.#api.cancelOrder(orderId);
    if (cancelled.ok && this.#state.purchase.order?.id === orderId) {
      this.dismiss();
    }
    await this.loadOrders();
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
    this.#setPurchase({ stage: PurchaseStage.SIGNING, order, cart: this.#state.purchase.cart });
    const paid = await this.#wallet.requestTransfer({ from: instructions.from, to: instructions.to, amount: instructions.amount, asset: instructions.asset, memo: instructions.memo });
    if (!paid.ok) {
      this.#setPurchase({ ...this.#state.purchase, stage: PurchaseStage.FAILED, error: paid.error });
      void this.loadOrders();
      return paid;
    }
    this.#sent.add(order.id);
    this.#setPurchase({ ...this.#state.purchase, stage: PurchaseStage.CONFIRMING, txId: paid.value });
    this.#takeFromCart(this.#state.purchase.cart ?? []);
    const hinted = await this.#api.paymentHint(order.id, paid.value);
    if (hinted.ok) {
      this.#setPurchase({ ...this.#state.purchase, order: hinted.value });
    }
    void this.loadOrders();
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
          void this.loadOrders();
          return ok(current.value);
        }
        if (TERMINAL.includes(current.value.status)) {
          const error = { code: current.value.status, message: `the order is ${current.value.status.toLowerCase()}` };
          this.#setPurchase({ ...this.#state.purchase, stage: PurchaseStage.FAILED, error });
          void this.loadOrders();
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

  /** @param {string} productId */
  #product(productId) {
    return this.#state.listing?.products.find((product) => product.id === productId);
  }

  /**
   * Takes paid lines out of the cart; what was added or raised meanwhile stays.
   * @param {readonly CartLine[]} paid
   */
  #takeFromCart(paid) {
    for (const { productId, quantity } of paid) {
      const line = this.#state.cart.find((candidate) => candidate.productId === productId);
      if (line !== undefined) {
        this.#setCartQuantity(productId, Math.max(0, line.quantity - quantity));
      }
    }
  }

  /**
   * @param {string} productId
   * @param {number} quantity 0 removes the line
   */
  #setCartQuantity(productId, quantity) {
    const cart = this.#state.cart;
    const line = Object.freeze({ productId, quantity });
    /** @type {CartLine[]} */
    let next;
    if (quantity === 0) {
      next = cart.filter((candidate) => candidate.productId !== productId);
    } else if (cart.some((candidate) => candidate.productId === productId)) {
      next = cart.map((candidate) => (candidate.productId === productId ? line : candidate));
    } else {
      next = [...cart, line];
    }
    this.#set({ cart: Object.freeze(next) });
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
