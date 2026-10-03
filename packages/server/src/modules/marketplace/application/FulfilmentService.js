/**
 * FulfilmentService: PAYMENT_VERIFIED → FULFILLED (docs/tcg/01-architettura.md §7.2).
 *
 * One unit of work claims the order (compare-and-set), mints what its items
 * give, opens its packs, saves bought decks, credits bought entries (the
 * entries module, docs/tcg/22-ingressi-ranked.md), queues the on-chain receipt and
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
  #entries;
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
   *   entries?: { credit: (purchase: { userId: string, kind: string, count: number, orderId: string }) => Promise<unknown> } | null,
   *   notifications: { notify: (userId: string, kind: string, data: Record<string, unknown>) => Promise<unknown> },
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   clock: import("../../../kernel/time.js").Clock,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   logger: import("../../../kernel/logger.js").Logger,
   * }} deps `entries`: where bought entries go (none: a product that gives entries cannot be fulfilled)
   */
  constructor({ orders, catalog, inventory, decks, epochs, payments, outbox, entries = null, notifications, audit, clock, unitOfWork, logger }) {
    this.#orders = orders;
    this.#catalog = catalog;
    this.#inventory = inventory;
    this.#decks = decks;
    this.#epochs = epochs;
    this.#payments = payments;
    this.#outbox = outbox;
    this.#entries = entries;
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
        entries: minted.entries,
      });
      await this.#audit.record({
        actorKind: "system",
        action: "marketplace.order_fulfilled",
        targetKind: "order",
        targetId: order.id,
        details: { cards: minted.cards.length + minted.packs.reduce((sum, pack) => sum + pack.cards.length, 0), packs: minted.packs.length, decksSaved: minted.decksSaved, entries: minted.entries, receiptParts: parts.length },
      });
      return true;
    });
  }

  /**
   * What a fulfilled order gave, for its buyer: the cards, pack by pack,
   * what is needed to re-check each pack once its epoch is revealed, and the
   * entries it credited.
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
    const view = (card) => Object.freeze({ id: card.id, definitionId: card.definitionId, edition: card.edition, serial: card.serial });
    return Object.freeze({
      txId: payment?.txId ?? null,
      cards: Object.freeze(cards.filter((card) => card.originKind === ORIGIN_PURCHASE).map(view)),
      packs: Object.freeze(
        packTables.map((table, index) =>
          Object.freeze({ index, epoch: order.rngEpochId, table: table.hash, cards: Object.freeze(cards.filter((card) => card.originKind === ORIGIN_PACK && card.originRef === packRef(order.id, index)).map(view)) }),
        ),
      ),
      entries: this.#entriesOf(order),
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
    const entries = this.#entriesOf(order);
    for (const item of order.items) {
      const product = this.#product(item.productId);
      const expansion = expandProduct(product, item.quantity, this.#catalog.products);
      const purchase = { kind: ORIGIN_PURCHASE, ref: order.id };
      if (expansion.cards.length > 0) {
        cards.push(...(await this.#mint(order.userId, expansion.cards, { edition: product.edition, origin: purchase })));
      }
      for (const deckId of expansion.decks) {
        const deck = /** @type {import("@magic8/engine/domain/decks/DeckList.js").DeckList} */ (this.#catalog.decks.get(deckId));
        cards.push(...(await this.#mint(order.userId, deck.entries.map((entry) => ({ definitionId: entry.cardId, count: entry.count })), { edition: product.edition, origin: purchase })));
        decksSaved += (await this.#saveDeck(order.userId, deck)) ? 1 : 0;
      }
      for (const tableId of expansion.packs) {
        packs.push(await this.#openPack(order, { tableId, index: packs.length, txId, secret }));
      }
    }
    for (const { kind, count } of entries) {
      await this.#creditEntries(order, kind, count);
    }
    return { cards, packs, decksSaved, entries };
  }

  /**
   * @param {import("../domain/Order.js").Order} order
   * @param {string} kind
   * @param {number} count
   */
  async #creditEntries(order, kind, count) {
    if (this.#entries === null) {
      throw new Error(`order ${order.id} gives ${kind} entries but nothing credits entries`);
    }
    await this.#entries.credit({ userId: order.userId, kind, count, orderId: order.id });
  }

  /**
   * The entries an order gives, by kind, its lines added up.
   * @param {import("../domain/Order.js").Order} order
   * @returns {readonly Readonly<{ kind: string, count: number }>[]}
   */
  #entriesOf(order) {
    /** @type {Map<string, number>} */
    const totals = new Map();
    for (const item of order.items) {
      for (const { kind, count } of expandProduct(this.#product(item.productId), item.quantity, this.#catalog.products).entries) {
        totals.set(kind, (totals.get(kind) ?? 0) + count);
      }
    }
    return Object.freeze([...totals].map(([kind, count]) => Object.freeze({ kind, count })));
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
    const minted = await this.#mint(order.userId, tally(drawn.map((card) => card.cardId)), { edition: resolved.table.edition, origin: { kind: ORIGIN_PACK, ref: packRef(order.id, index) } });
    return Object.freeze({ index, epoch: order.rngEpochId, table: resolved.hash, cards: Object.freeze(minted) });
  }

  /**
   * @param {string} ownerId
   * @param {readonly { definitionId: string, count: number }[]} items
   * @param {{ edition: string, origin: { kind: string, ref: string } }} printing
   */
  async #mint(ownerId, items, { edition, origin }) {
    /** @type {CardInstance[]} */
    const minted = [];
    for (const chunk of chunks(items, MINT_CHUNK)) {
      minted.push(...(await this.#inventory.mint({ ownerId, items: chunk, edition, origin })));
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
      await this.#decks.create(userId, { name: deck.name, cards: deck.entries.map((entry) => ({ cardId: entry.cardId, count: entry.count })) });
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
 * @param {readonly string[]} definitionIds
 * @returns {{ definitionId: string, count: number }[]} identical cards merged
 */
function tally(definitionIds) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const definitionId of definitionIds) {
    counts.set(definitionId, (counts.get(definitionId) ?? 0) + 1);
  }
  return [...counts].map(([definitionId, count]) => ({ definitionId, count }));
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
