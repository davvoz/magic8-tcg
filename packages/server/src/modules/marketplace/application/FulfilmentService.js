/**
 * FulfilmentService: PAYMENT_VERIFIED → FULFILLED (docs/tcg/01-architettura.md §7.2).
 *
 * One unit of work claims the order (compare-and-set), mints what its items
 * give, opens its packs, saves bought decks, queues the on-chain receipt and
 * writes the audit entry and the buyer's notification (docs/tcg/15). Either all of it happens or none: a crash or a
 * concurrent worker can never mint an order twice (T9), and a failure leaves
 * the order verified, to be retried.
 *
 * Packs: pack `index` of an order is drawn from
 *   packSeed({ secret: epoch secret, orderId, txId: payment transaction, index })
 * (@magic8/protocol), so it depends on a secret committed before the sale and
 * on a transaction id the server could not know in advance.
 */
import { buildReceipts, drawPack, packSeed } from "@magic8/protocol";
import { AppError } from "../../../kernel/AppError.js";
import { NotificationKind, countCards } from "../../notifications/index.js";
import { OrderStatus } from "../domain/Order.js";
import { expandProduct } from "../domain/Product.js";

const ORIGIN_PURCHASE = "purchase";
const ORIGIN_PACK = "pack";
/** InventoryService mints at most this many copies per call. */
const MINT_CHUNK = 500;
const BATCH = 20;

/**
 * @typedef {import("../../collection/domain/CardInstance.js").CardInstance} CardInstance
 * @typedef {Readonly<{ index: number, epoch: number, table: string, cards: readonly CardInstance[] }>} OpenedPack
 */

export class FulfilmentService {
  #orders;
  #catalog;
  #inventory;
  #decks;
  #epochs;
  #payments;
  #outbox;
  #notifications;
  #audit;
  #clock;
  #unitOfWork;
  #logger;

  /**
   * @param {{
   *   orders: import("./ports.js").MarketplaceRepository,
   *   catalog: import("../domain/MarketCatalog.js").MarketCatalog,
   *   inventory: import("../../collection/index.js").InventoryService,
   *   decks: import("../../decks/index.js").DeckService,
   *   epochs: import("./PackEpochService.js").PackEpochService,
   *   payments: import("../../payments/index.js").PaymentService,
   *   outbox: import("../../chain/index.js").ChainOutbox,
   *   notifications: { notify: (userId: string, kind: string, data: Record<string, unknown>) => Promise<unknown> },
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   clock: import("../../../kernel/time.js").Clock,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   logger: import("../../../kernel/logger.js").Logger,
   * }} deps
   */
  constructor({ orders, catalog, inventory, decks, epochs, payments, outbox, notifications, audit, clock, unitOfWork, logger }) {
    this.#orders = orders;
    this.#catalog = catalog;
    this.#inventory = inventory;
    this.#decks = decks;
    this.#epochs = epochs;
    this.#payments = payments;
    this.#outbox = outbox;
    this.#notifications = notifications;
    this.#audit = audit;
    this.#clock = clock;
    this.#unitOfWork = unitOfWork;
    this.#logger = logger;
  }

  /**
   * Fulfils verified orders, oldest first. One failing order does not block the others.
   * @returns {Promise<number>} orders fulfilled
   */
  async fulfilVerified() {
    let fulfilled = 0;
    for (const id of await this.#orders.listByStatus(OrderStatus.PAYMENT_VERIFIED, BATCH)) {
      try {
        fulfilled += (await this.fulfil(id)) ? 1 : 0;
      } catch (error) {
        this.#logger.error("order fulfilment failed; it stays verified and will be retried", { order: id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return fulfilled;
  }

  /**
   * @param {string} orderId
   * @returns {Promise<boolean>} false when the order was not (or no longer) waiting for fulfilment
   */
  fulfil(orderId) {
    return this.#unitOfWork(async () => {
      const order = await this.#orders.findOrder(orderId);
      if (order === null || order.status !== OrderStatus.PAYMENT_VERIFIED) {
        return false;
      }
      if ((await this.#orders.transition(order.id, OrderStatus.PAYMENT_VERIFIED, OrderStatus.FULFILLED, { at: this.#clock.now() })) === null) {
        return false;
      }
      const payment = await this.#payments.find(/** @type {string} */ (order.paymentId));
      if (payment === null) {
        throw new Error(`order ${order.id} is verified without a payment`);
      }
      const secret = order.rngEpochId === null ? null : await this.#epochs.secretOf(order.rngEpochId);
      const minted = await this.#mintItems(order, { txId: payment.txId, secret });
      const parts = buildReceipts({
        orderId: order.id,
        account: order.payer,
        network: order.network,
        txId: payment.txId,
        items: order.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
        packs: minted.packs.map((pack) => ({ epoch: pack.epoch, index: pack.index, table: pack.table })),
        cards: [...minted.cards, ...minted.packs.flatMap((pack) => pack.cards)],
      });
      await this.#outbox.enqueueReceipt({ network: order.network, orderId: order.id, parts });
      const allCards = [...minted.cards, ...minted.packs.flatMap((pack) => pack.cards)];
      await this.#notifications.notify(order.userId, NotificationKind.ORDER_FULFILLED, {
        orderId: order.id,
        items: order.items.map((item) => ({ productId: item.productId, name: this.#catalog.products.get(item.productId)?.name ?? item.productId, quantity: item.quantity })),
        cards: countCards(allCards),
        total: allCards.length,
      });
      await this.#audit.record({
        actorKind: "system",
        action: "marketplace.order_fulfilled",
        targetKind: "order",
        targetId: order.id,
        details: { cards: minted.cards.length + minted.packs.reduce((sum, pack) => sum + pack.cards.length, 0), packs: minted.packs.length, decksSaved: minted.decksSaved, receiptParts: parts.length },
      });
      return true;
    });
  }

  /**
   * What a fulfilled order gave, for its buyer: the cards, pack by pack, and
   * what is needed to re-check each pack once its epoch is revealed.
   * @param {import("../domain/Order.js").Order} order
   */
  async describe(order) {
    if (order.status !== OrderStatus.FULFILLED) {
      return null;
    }
    const packTables = this.#packTables(order);
    const origins = [{ kind: ORIGIN_PURCHASE, ref: order.id }, ...packTables.map((_, index) => ({ kind: ORIGIN_PACK, ref: packRef(order.id, index) }))];
    const cards = await this.#inventory.mintedFor(order.userId, origins);
    const payment = order.paymentId === null ? null : await this.#payments.find(order.paymentId);
    const view = (card) => Object.freeze({ id: card.id, definitionId: card.definitionId, edition: card.edition, serial: card.serial, finish: card.finish });
    return Object.freeze({
      txId: payment?.txId ?? null,
      cards: Object.freeze(cards.filter((card) => card.originKind === ORIGIN_PURCHASE).map(view)),
      packs: Object.freeze(
        packTables.map((table, index) =>
          Object.freeze({ index, epoch: order.rngEpochId, table: table.hash, cards: Object.freeze(cards.filter((card) => card.originKind === ORIGIN_PACK && card.originRef === packRef(order.id, index)).map(view)) }),
        ),
      ),
    });
  }

  /**
   * @param {import("../domain/Order.js").Order} order
   * @param {{ txId: string, secret: string | null }} draw
   */
  async #mintItems(order, { txId, secret }) {
    /** @type {CardInstance[]} */
    const cards = [];
    /** @type {OpenedPack[]} */
    const packs = [];
    let decksSaved = 0;
    for (const item of order.items) {
      const product = this.#product(item.productId);
      const expansion = expandProduct(product, item.quantity, this.#catalog.products);
      const purchase = { kind: ORIGIN_PURCHASE, ref: order.id };
      for (const [finish, items] of groupByFinish(expansion.cards)) {
        cards.push(...(await this.#mint(order.userId, items, { edition: product.edition, finish, origin: purchase })));
      }
      for (const { deckId, finish } of expansion.decks) {
        const deck = /** @type {import("@magic8/engine/domain/decks/DeckList.js").DeckList} */ (this.#catalog.decks.get(deckId));
        cards.push(...(await this.#mint(order.userId, deck.entries.map((entry) => ({ definitionId: entry.cardId, count: entry.count })), { edition: product.edition, finish, origin: purchase })));
        decksSaved += (await this.#saveDeck(order.userId, deck)) ? 1 : 0;
      }
      for (const tableId of expansion.packs) {
        packs.push(await this.#openPack(order, { tableId, index: packs.length, txId, secret }));
      }
    }
    return { cards, packs, decksSaved };
  }

  /**
   * @param {import("../domain/Order.js").Order} order
   * @param {{ tableId: string, index: number, txId: string, secret: string | null }} pack
   * @returns {Promise<OpenedPack>}
   */
  async #openPack(order, { tableId, index, txId, secret }) {
    if (secret === null || order.rngEpochId === null) {
      throw new Error(`order ${order.id} has packs but no pack epoch`);
    }
    const resolved = /** @type {import("../domain/DropTables.js").ResolvedDropTable} */ (this.#catalog.dropTables.get(tableId));
    const drawn = drawPack(resolved.table, packSeed({ secret, orderId: order.id, txId, index }));
    /** @type {CardInstance[]} */
    const minted = [];
    const origin = { kind: ORIGIN_PACK, ref: packRef(order.id, index) };
    for (const [finish, items] of groupByFinish(drawn.map((card) => ({ definitionId: card.cardId, count: 1, finish: card.finish })))) {
      minted.push(...(await this.#mint(order.userId, items, { edition: resolved.table.edition, finish, origin })));
    }
    return Object.freeze({ index, epoch: order.rngEpochId, table: resolved.hash, cards: Object.freeze(minted) });
  }

  /**
   * @param {string} ownerId
   * @param {readonly { definitionId: string, count: number }[]} items
   * @param {{ edition: string, finish: string, origin: { kind: string, ref: string } }} printing
   */
  async #mint(ownerId, items, { edition, finish, origin }) {
    /** @type {CardInstance[]} */
    const minted = [];
    for (const chunk of chunks(items, MINT_CHUNK)) {
      minted.push(...(await this.#inventory.mint({ ownerId, items: chunk, edition, finish, origin })));
    }
    return minted;
  }

  /**
   * Saves a bought deck to the account. A full deck list does not stop the
   * purchase: the cards are the player's anyway.
   * @param {string} userId
   * @param {import("@magic8/engine/domain/decks/DeckList.js").DeckList} deck
   */
  async #saveDeck(userId, deck) {
    try {
      await this.#decks.create(userId, { name: deck.name, faction: deck.faction, cards: deck.entries.map((entry) => ({ cardId: entry.cardId, count: entry.count })) });
      return true;
    } catch (error) {
      if (error instanceof AppError && error.code === "LIMIT_REACHED") {
        this.#logger.info("bought deck not saved: the player's deck list is full", { user: userId, deck: deck.id });
        return false;
      }
      throw error;
    }
  }

  /** @param {import("../domain/Order.js").Order} order */
  #packTables(order) {
    return order.items.flatMap((item) => expandProduct(this.#product(item.productId), item.quantity, this.#catalog.products).packs.map((tableId) => /** @type {import("../domain/DropTables.js").ResolvedDropTable} */ (this.#catalog.dropTables.get(tableId))));
  }

  /** @param {string} productId */
  #product(productId) {
    const product = this.#catalog.products.get(productId);
    if (product === undefined) {
      // Products are retired with "active": false, never deleted, so paid orders can always be fulfilled.
      throw new Error(`product ${productId} is no longer in the data; restore it to fulfil its orders`);
    }
    return product;
  }
}

/**
 * @param {string} orderId
 * @param {number} index
 */
const packRef = (orderId, index) => `${orderId}/${index}`;

/**
 * @param {readonly { definitionId: string, count: number, finish: string }[]} items
 * @returns {Map<string, { definitionId: string, count: number }[]>} finish → items (identical cards merged)
 */
function groupByFinish(items) {
  /** @type {Map<string, Map<string, number>>} */
  const groups = new Map();
  for (const { definitionId, count, finish } of items) {
    const group = groups.get(finish) ?? new Map();
    group.set(definitionId, (group.get(definitionId) ?? 0) + count);
    groups.set(finish, group);
  }
  return new Map([...groups].map(([finish, counts]) => [finish, [...counts].map(([definitionId, count]) => ({ definitionId, count }))]));
}

/**
 * Splits items so that no chunk holds more than `max` copies (an item larger than `max` is split too).
 * @param {readonly { definitionId: string, count: number }[]} items
 * @param {number} max
 */
function chunks(items, max) {
  /** @type {{ definitionId: string, count: number }[][]} */
  const result = [[]];
  let size = 0;
  for (const item of items) {
    let remaining = item.count;
    while (remaining > 0) {
      if (size === max) {
        result.push([]);
        size = 0;
      }
      const take = Math.min(remaining, max - size);
      result[result.length - 1].push({ definitionId: item.definitionId, count: take });
      size += take;
      remaining -= take;
    }
  }
  return result.filter((chunk) => chunk.length > 0);
}
