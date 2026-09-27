/**
 * MarketplaceService: the product listing and the orders' life before
 * payment (docs/tcg/02-protocollo-multiplayer.md §2, Marketplace).
 *
 * - The client names its lines (a product and a quantity each: one line for
 *   "buy now", several for a cart) and an asset; the prices come from the
 *   server's price list and are frozen into the order (T3). One order is
 *   one payment, whatever the number of lines.
 * - Creating an order needs an Idempotency-Key: the same key with the same
 *   request returns the same order, with a different request it is refused;
 *   UNIQUE (user_id, idempotency_key) holds even for concurrent requests (T4).
 * - The memo is an opaque random reference; the payment must come from the
 *   buyer's own account (T6), before the order expires.
 * - Orders with packs are bound to the open pack epoch at creation. When
 *   the chain is in use, only once the epoch's commitment is on chain: the
 *   buyer pays after that, so the secret was fixed before the transaction
 *   id that seeds the pack existed (otherwise the server could have picked
 *   a secret knowing it).
 * - Every state change is a compare-and-set (T7).
 */
import { canonicalize, sha256Hex, utf8 } from "@magic8/protocol";
import { AppError } from "../../../kernel/AppError.js";
import { assertImplements } from "../../../kernel/contracts.js";
import { isUuid, uuidV4 } from "../../../kernel/random.js";
import { safeAdd } from "../../economy/index.js";
import { AWAITING_PAYMENT, OrderStatus, memoFrom } from "../domain/Order.js";
import { ContentType, MAX_CARDS_PER_ORDER, expandProduct } from "../domain/Product.js";
import { MARKETPLACE_REPOSITORY_METHODS } from "./ports.js";

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const MEMO_RANDOM_BYTES = 17;
const ORDER_HISTORY_LIMIT = 50;
/** Most lines (different products) in one order. */
export const MAX_ORDER_LINES = 20;
const EXPIRY_BATCH = 100;

/**
 * @typedef {Readonly<{ orderTtlMs: number, expiryGraceMs: number, maxOpenOrders: number, epochMaxAgeMs: number }>} MarketplacePolicy
 * @typedef {Readonly<{ id: string, account: string, network: string }>} Buyer
 */

export const DEFAULT_MARKETPLACE_POLICY = Object.freeze({
  /** How long a player has to pay. */
  orderTtlMs: 30 * 60 * 1000,
  /**
   * An order is expired only this long after its deadline: a transfer made
   * just in time may be seen by the watcher a little later. Whether it was in
   * time is decided by the block's timestamp, not by when we saw it.
   */
  expiryGraceMs: 10 * 60 * 1000,
  maxOpenOrders: 5,
  /** A pack epoch takes orders for this long; its secret is revealed once its orders are settled. */
  epochMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
});

export class MarketplaceService {
  #catalog;
  #economy;
  #repository;
  #epochs;
  #commitmentAnchored;
  #receiverFor;
  #audit;
  #clock;
  #random;
  #unitOfWork;
  #policy;
  #describe;

  /**
   * @param {{
   *   catalog: import("../domain/MarketCatalog.js").MarketCatalog,
   *   economy: import("../../economy/index.js").EconomyService,
   *   repository: import("./ports.js").MarketplaceRepository,
   *   epochs: import("./PackEpochService.js").PackEpochService,
   *   receiverFor: (network: string) => string,
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   clock: import("../../../kernel/time.js").Clock,
   *   random: import("../../../kernel/random.js").SecureRandom,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   policy?: Partial<MarketplacePolicy>,
   *   describeFulfilment?: (order: import("../domain/Order.js").Order) => Promise<unknown>,
   *   commitmentAnchored?: ((epoch: Readonly<{ id: number, commit: string }>) => Promise<boolean>) | null,
   * }} deps `commitmentAnchored`: null when nothing is published on chain (development)
   */
  constructor({ catalog, economy, repository, epochs, receiverFor, audit, clock, random, unitOfWork, policy = {}, describeFulfilment = async () => null, commitmentAnchored = null }) {
    assertImplements(repository, MARKETPLACE_REPOSITORY_METHODS, "MarketplaceRepository");
    this.#catalog = catalog;
    this.#economy = economy;
    this.#repository = repository;
    this.#epochs = epochs;
    this.#receiverFor = receiverFor;
    this.#audit = audit;
    this.#clock = clock;
    this.#random = random;
    this.#unitOfWork = unitOfWork;
    this.#policy = Object.freeze({ ...DEFAULT_MARKETPLACE_POLICY, ...policy });
    this.#describe = describeFulfilment;
    this.#commitmentAnchored = commitmentAnchored;
  }

  /** The open pack epoch, provided its commitment is on chain (when the chain is in use). */
  async #sellableEpoch() {
    const epoch = await this.#epochs.current();
    if (this.#commitmentAnchored !== null && !(await this.#commitmentAnchored(epoch))) {
      throw new AppError("CHAIN_UNAVAILABLE", "packs are on sale again in a few seconds: the pack epoch's commitment is being published on chain");
    }
    return epoch;
  }

  get catalog() {
    return this.#catalog;
  }

  get policy() {
    return this.#policy;
  }

  /** Mirrors the product data into the database (order items reference products). */
  syncProducts() {
    return this.#repository.syncProducts([...this.#catalog.products.values()], this.#clock.now());
  }

  /** What is on sale now, with prices, contents, the odds of every pack and the price list by rarity. */
  async listing() {
    const now = this.#clock.now();
    const products = [...this.#catalog.products.values()].filter((product) => isOnSale(product, now)).map((product) => this.#productView(product));
    const dropTables = [...this.#catalog.dropTables.values()].map(({ table, hash, size, odds }) =>
      Object.freeze({ id: table.id, hash, edition: table.edition, size, odds, foil: table.foil, pools: table.pools, table }),
    );
    const { asset, singles } = this.#catalog.priceList;
    const format = (units) => this.#economy.format(units, asset);
    const priceList = Object.freeze({
      asset,
      singles: Object.freeze([...singles].map(([rarity, price]) => Object.freeze({ rarity, standard: format(price.standard), foil: price.foil === null ? null : format(price.foil) }))),
    });
    return Object.freeze({ products: Object.freeze(products), dropTables: Object.freeze(dropTables), rarities: this.#catalog.rarities.order, priceList });
  }

  /**
   * @param {{ buyer: Buyer, items: readonly Readonly<{ productId: unknown, quantity: unknown }>[], asset: unknown, idempotencyKey: string | null, ip: string }} request
   */
  async createOrder({ buyer, items, asset, idempotencyKey, ip }) {
    if (idempotencyKey === null || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new AppError("PRECONDITION_REQUIRED", "send an Idempotency-Key header (16 to 64 letters, digits, - or _)");
    }
    if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ORDER_LINES) {
      throw new AppError("VALIDATION", `an order has 1..${MAX_ORDER_LINES} lines`);
    }
    const requestHash = sha256Hex(
      utf8(canonicalize({ items: items.map(({ productId, quantity }) => ({ productId: String(productId), quantity: Number.isSafeInteger(quantity) ? quantity : String(quantity) })), asset: String(asset) })),
    );
    const previous = await this.#repository.findByIdempotencyKey(buyer.id, idempotencyKey);
    if (previous !== null) {
      return this.#replay(previous, requestHash);
    }
    const { lines, quote } = this.#priceRequest({ items, asset, buyer });
    if ((await this.#repository.countOpen(buyer.id)) >= this.#policy.maxOpenOrders) {
      throw new AppError("LIMIT_REACHED", `at most ${this.#policy.maxOpenOrders} unpaid orders at a time: pay or cancel one first`);
    }
    const hasPacks = lines.some(({ product, count }) => expandProduct(product, count, this.#catalog.products).packs.length > 0);
    const epoch = hasPacks ? await this.#sellableEpoch() : null;
    const now = this.#clock.now();
    /** @type {import("../domain/Order.js").Order} */
    const order = Object.freeze({
      id: uuidV4(this.#random),
      userId: buyer.id,
      status: OrderStatus.PAYMENT_PENDING,
      network: quote.network,
      asset: quote.asset,
      totalAmount: quote.totalAmount,
      receiver: this.#receiverFor(quote.network),
      payer: buyer.account,
      memo: memoFrom(this.#random.bytes(MEMO_RANDOM_BYTES)),
      expiresAt: now + this.#policy.orderTtlMs,
      idempotencyKey,
      requestHash,
      paymentId: null,
      rngEpochId: epoch?.id ?? null,
      failureReason: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      items: Object.freeze(lines.map(({ product, count, unitAmount }, position) => Object.freeze({ position, productId: product.id, quantity: count, unitAmount }))),
    });
    const inserted = await this.#unitOfWork(async () => {
      if (!(await this.#repository.insertOrder(order))) {
        return false;
      }
      await this.#audit.record({ actorKind: "user", actorUserId: buyer.id, action: "marketplace.order_created", targetKind: "order", targetId: order.id, ip, details: { items: lines.map(({ product, count }) => ({ product: product.id, quantity: count })), asset: quote.asset, total: quote.totalAmount, epoch: order.rngEpochId } });
      return true;
    });
    if (!inserted) {
      // A concurrent request with the same key won the race: answer as it did.
      return this.#replay(/** @type {import("../domain/Order.js").Order} */ (await this.#repository.findByIdempotencyKey(buyer.id, idempotencyKey)), requestHash);
    }
    return Object.freeze({ created: true, order: this.orderView(order) });
  }

  /**
   * @param {string} userId
   * @param {unknown} orderId
   */
  async getOrder(userId, orderId) {
    const order = await this.#ownOrder(userId, orderId);
    return Object.freeze({ ...this.orderView(order), fulfilment: await this.#describe(order) });
  }

  /** @param {string} userId */
  async listOrders(userId) {
    const orders = await this.#repository.listForUser(userId, ORDER_HISTORY_LIMIT);
    return Object.freeze(orders.map((order) => this.orderView(order)));
  }

  /**
   * @param {{ userId: string, orderId: unknown, ip: string }} request
   */
  async cancel({ userId, orderId, ip }) {
    const order = await this.#ownOrder(userId, orderId);
    if (!AWAITING_PAYMENT.includes(order.status)) {
      throw new AppError("CONFLICT", `an order that is ${order.status.toLowerCase().replaceAll("_", " ")} cannot be cancelled`);
    }
    return this.#unitOfWork(async () => {
      const cancelled = await this.#repository.transition(order.id, order.status, OrderStatus.CANCELLED, { at: this.#clock.now() });
      if (cancelled === null) {
        throw new AppError("CONFLICT", "the order changed meanwhile; reload it");
      }
      await this.#audit.record({ actorKind: "user", actorUserId: userId, action: "marketplace.order_cancelled", targetKind: "order", targetId: order.id, ip });
      return this.orderView(cancelled);
    });
  }

  /**
   * Expires unpaid orders past their deadline plus the grace period.
   * @returns {Promise<number>} orders expired
   */
  async expireDue() {
    const ids = await this.#repository.listExpirable(this.#clock.now() - this.#policy.expiryGraceMs, EXPIRY_BATCH);
    let expired = 0;
    for (const id of ids) {
      const order = await this.#repository.findOrder(id);
      if (order !== null && AWAITING_PAYMENT.includes(order.status)) {
        const changed = await this.#repository.transition(id, order.status, OrderStatus.EXPIRED, { at: this.#clock.now() });
        expired += changed === null ? 0 : 1;
      }
    }
    return expired;
  }

  /**
   * The public view of an order. Payment instructions only while it can be paid.
   * @param {import("../domain/Order.js").Order} order
   */
  orderView(order) {
    const format = (units) => this.#economy.format(units, order.asset);
    return Object.freeze({
      id: order.id,
      status: order.status,
      items: Object.freeze(order.items.map((item) => Object.freeze({ productId: item.productId, name: this.#catalog.products.get(item.productId)?.name ?? item.productId, quantity: item.quantity, unitAmount: format(item.unitAmount) }))),
      total: Object.freeze({ asset: order.asset, amount: format(order.totalAmount) }),
      payment: AWAITING_PAYMENT.includes(order.status)
        ? Object.freeze({ network: order.network, from: order.payer, to: order.receiver, asset: order.asset, amount: format(order.totalAmount), memo: order.memo, expiresAt: order.expiresAt })
        : null,
      rngEpochId: order.rngEpochId,
      failureReason: order.failureReason,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    });
  }

  /**
   * Validates the lines the client asked for and prices them from the server's list.
   * @param {{ items: readonly Readonly<{ productId: unknown, quantity: unknown }>[], asset: unknown, buyer: Buyer }} request
   * @returns {{ lines: { product: import("../domain/Product.js").Product, count: number, unitAmount: number }[], quote: { network: string, asset: string, totalAmount: number } }}
   */
  #priceRequest({ items, asset, buyer }) {
    if (new Set(items.map((item) => item.productId)).size !== items.length) {
      throw new AppError("VALIDATION", "each product may appear once in an order: add up its quantities");
    }
    if (typeof asset !== "string") {
      throw new AppError("VALIDATION", "asset must be a string");
    }
    const lines = items.map(({ productId, quantity }) => this.#priceLine({ productId, quantity, asset, buyer }));
    if (lines.reduce((sum, { product, count }) => sum + product.cardsPerUnit * count, 0) > MAX_CARDS_PER_ORDER) {
      throw new AppError("VALIDATION", `at most ${MAX_CARDS_PER_ORDER} cards per order`);
    }
    const totalAmount = lines.reduce((/** @type {number | null} */ sum, line) => (sum === null ? null : safeAdd(sum, line.totalAmount)), 0);
    if (totalAmount === null) {
      throw new AppError("VALIDATION", "order total too large");
    }
    return { lines, quote: { network: lines[0].network, asset, totalAmount } };
  }

  /**
   * One line of an order, priced.
   * @param {{ productId: unknown, quantity: unknown, asset: string, buyer: Buyer }} request
   */
  #priceLine({ productId, quantity, asset, buyer }) {
    const product = typeof productId === "string" ? this.#catalog.products.get(productId) : undefined;
    if (product === undefined) {
      throw new AppError("NOT_FOUND", "no such product");
    }
    if (!isOnSale(product, this.#clock.now())) {
      throw new AppError("CONFLICT", "this product is not on sale");
    }
    if (!Number.isSafeInteger(quantity) || /** @type {number} */ (quantity) < 1 || /** @type {number} */ (quantity) > product.limits.perOrder) {
      throw new AppError("VALIDATION", `quantity must be 1..${product.limits.perOrder}`);
    }
    const count = /** @type {number} */ (quantity);
    const quote = this.#economy.quote(product, count, asset);
    if (quote.network !== buyer.network) {
      throw new AppError("VALIDATION", `${asset} is paid on ${quote.network}; you are signed in on ${buyer.network}`);
    }
    return { product, count, network: quote.network, unitAmount: quote.unitAmount, totalAmount: quote.totalAmount };
  }

  /**
   * @param {import("../domain/Order.js").Order} order
   * @param {string} requestHash
   */
  #replay(order, requestHash) {
    if (order.requestHash !== requestHash) {
      throw new AppError("CONFLICT", "this Idempotency-Key was used for a different order");
    }
    return Object.freeze({ created: false, order: this.orderView(order) });
  }

  /**
   * @param {string} userId
   * @param {unknown} orderId
   */
  async #ownOrder(userId, orderId) {
    const order = isUuid(orderId) ? await this.#repository.findOrder(/** @type {string} */ (orderId)) : null;
    // Someone else's order is "not found": ids of other players' orders reveal nothing.
    if (order === null || order.userId !== userId) {
      throw new AppError("NOT_FOUND", "no such order");
    }
    return order;
  }

  /**
   * The rarity of a product that is one card, null for anything else.
   * @param {import("../domain/Product.js").Product} product
   */
  #rarityOf({ contents }) {
    const [only] = contents;
    return contents.length === 1 && only.type === ContentType.CARD && only.count === 1 ? (this.#catalog.rarities.of.get(only.ref) ?? null) : null;
  }

  /** @param {import("../domain/Product.js").Product} product */
  #productView(product) {
    return Object.freeze({
      id: product.id,
      kind: product.kind,
      name: product.name,
      description: product.description,
      prices: Object.freeze([...product.prices].map(([asset, units]) => Object.freeze({ asset, amount: this.#economy.format(units, asset) }))),
      contents: product.contents,
      rarity: this.#rarityOf(product),
      cards: product.cardsPerUnit,
      limits: product.limits,
    });
  }
}

/**
 * @param {import("../domain/Product.js").Product} product
 * @param {number} now
 */
function isOnSale(product, now) {
  const { availableFrom, availableUntil } = product.limits;
  return product.active && (availableFrom === null || now >= availableFrom) && (availableUntil === null || now < availableUntil);
}
