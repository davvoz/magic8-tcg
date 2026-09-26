/**
 * SaleSettlement: turns payments from buyers to sellers, seen on chain,
 * into copies changing hands (docs/tcg/14-vendite.md). A job runs it every
 * few seconds; a buyer's payment hint only makes it look at their purchase
 * sooner.
 *
 *   scan      a pending purchase: the seller's history after the purchase's
 *             cursor; the transfer carrying its memo, from the buyer, of
 *             exactly the price, in time, makes it DETECTED. A transfer with
 *             the memo that does not match is noted as the purchase's
 *             problem (the buyer is told) and pays nothing.
 *   confirm   a detected purchase whose transfer is irreversible on a
 *             quorum of nodes: in one unit of work the copy passes to the
 *             buyer, the listing is SOLD and the m8tcg_sale record is
 *             queued. A transfer that left the chain (micro-fork) sends the
 *             purchase back to PENDING, to be read again from the start.
 *   expire    a pending purchase past its deadline plus the grace period,
 *             after one last scan: the listing is free again.
 *
 * Seller and buyer hear of a sale, an expired reservation and a payment
 * that does not match in their notification feed, written in the unit of
 * work of the change (docs/tcg/15-notifiche.md).
 *
 * The funds never pass through the server. Every change is a
 * compare-and-set: several server processes may run this at once.
 */
import { saleRecord } from "@magic8/protocol";
import { AppError } from "../../../kernel/AppError.js";
import { isUuid } from "../../../kernel/random.js";
import { NotificationKind } from "../../notifications/index.js";
import { ListingStatus, PurchaseStatus, SALE_MEMO_PATTERN, matchSaleTransfer } from "../domain/Listing.js";
import { refOf } from "./SalesService.js";

const TX_ID_PATTERN = /^[0-9a-f]{40}$/;
const PAGE_SIZE = 100;
const MAX_PAGES_PER_SCAN = 20;
const LIVE_BATCH = 100;
const HINT_COOLDOWN_MS = 3000;

export class SaleSettlement {
  #repository;
  #sales;
  #inventory;
  #providers;
  #outbox;
  #notifications;
  #audit;
  #clock;
  #unitOfWork;
  #logger;
  /** @type {Map<string, number>} purchase → last hint-triggered look */
  #lastHint = new Map();

  /**
   * @param {{
   *   repository: import("../infrastructure/PgSalesRepository.js").PgSalesRepository,
   *   sales: import("./SalesService.js").SalesService,
   *   inventory: import("../../collection/index.js").InventoryService,
   *   providers: ReadonlyMap<string, import("../../payments/application/ports.js").PaymentProvider>,
   *   outbox: { enqueueSale: (entry: { network: string, listingId: string, payload: string }) => Promise<void> },
   *   notifications: { notify: (userId: string, kind: string, data: Record<string, unknown>) => Promise<unknown> },
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   clock: import("../../../kernel/time.js").Clock,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   logger: import("../../../kernel/logger.js").Logger,
   * }} deps
   */
  constructor({ repository, sales, inventory, providers, outbox, notifications, audit, clock, unitOfWork, logger }) {
    this.#repository = repository;
    this.#sales = sales;
    this.#inventory = inventory;
    this.#providers = providers;
    this.#outbox = outbox;
    this.#notifications = notifications;
    this.#audit = audit;
    this.#clock = clock;
    this.#unitOfWork = unitOfWork;
    this.#logger = logger;
  }

  /**
   * One pass over every live purchase.
   * @returns {Promise<{ detected: number, completed: number, expired: number }>}
   */
  async runOnce() {
    const outcome = { detected: 0, completed: 0, expired: 0 };
    for (const purchase of await this.#repository.listLivePurchases(LIVE_BATCH)) {
      try {
        const settled = await this.#settle(purchase);
        outcome.detected += settled.detected ? 1 : 0;
        outcome.completed += settled.completed ? 1 : 0;
        outcome.expired += settled.expired ? 1 : 0;
      } catch (error) {
        // One unreadable seller history must not hold up every other sale.
        this.#logger.warn("a sale could not be settled now", { purchase: purchase.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return outcome;
  }

  /**
   * The buyer says they paid: look at their purchase now. The transaction id
   * is not trusted for anything; the seller's history is read as always.
   * @param {{ userId: string, purchaseId: unknown, txId: unknown }} hint
   */
  async hint({ userId, purchaseId, txId }) {
    if (typeof txId !== "string" || !TX_ID_PATTERN.test(txId)) {
      throw new AppError("VALIDATION", "txId must be a transaction id (40 hex characters)");
    }
    const purchase = await this.#ownPurchase(userId, purchaseId);
    const now = this.#clock.now();
    if (now - (this.#lastHint.get(purchase.id) ?? Number.NEGATIVE_INFINITY) >= HINT_COOLDOWN_MS) {
      this.#lastHint.set(purchase.id, now);
      await this.#settle(purchase);
    }
    return this.#sales.purchaseView(userId, purchase.id);
  }

  /**
   * The buyer gives up a purchase they have not paid (their wallet refused,
   * they changed their mind). The seller's history is read first: a payment
   * already made is never abandoned.
   * @param {{ userId: string, purchaseId: unknown, ip: string }} request
   */
  async release({ userId, purchaseId, ip }) {
    const purchase = await this.#ownPurchase(userId, purchaseId);
    if (purchase.status !== PurchaseStatus.PENDING) {
      throw new AppError("CONFLICT", purchase.status === PurchaseStatus.DETECTED ? "your payment was seen: the card is on its way" : `this purchase is already ${purchase.status.toLowerCase()}`);
    }
    if (await this.#scan(purchase)) {
      throw new AppError("CONFLICT", "your payment was seen: the card is on its way");
    }
    const released = await this.#unitOfWork(async () => {
      const closed = await this.#repository.transitionPurchase(purchase.id, PurchaseStatus.PENDING, PurchaseStatus.CANCELLED, { closedAt: this.#clock.now() });
      if (closed !== null) {
        await this.#audit.record({ actorKind: "user", actorUserId: userId, action: "sales.released", targetKind: "purchase", targetId: purchase.id, ip });
      }
      return closed;
    });
    if (released === null) {
      throw new AppError("CONFLICT", "the purchase changed meanwhile; reload it");
    }
    await this.#tellAbout(purchase);
    return this.#sales.purchaseView(userId, purchase.id);
  }

  /**
   * @param {import("../domain/Listing.js").Purchase} purchase
   * @returns {Promise<{ detected: boolean, completed: boolean, expired: boolean }>}
   */
  async #settle(purchase) {
    let current = purchase;
    let detected = false;
    if (current.status === PurchaseStatus.PENDING) {
      detected = await this.#scan(current);
      current = /** @type {import("../domain/Listing.js").Purchase} */ (await this.#repository.findPurchase(current.id));
    }
    if (current.status === PurchaseStatus.DETECTED) {
      return { detected, completed: await this.#confirm(current), expired: false };
    }
    if (current.status === PurchaseStatus.PENDING && this.#clock.now() >= current.expiresAt + this.#sales.policy.expiryGraceMs) {
      return { detected, completed: false, expired: await this.#expire(current) };
    }
    return { detected, completed: false, expired: false };
  }

  /**
   * Reads the seller's history after the purchase's cursor for the transfer that pays it.
   * @param {import("../domain/Listing.js").Purchase} purchase
   * @returns {Promise<boolean>} whether the purchase is now DETECTED
   */
  async #scan(purchase) {
    const provider = this.#provider(purchase.network);
    let cursor = purchase.cursor;
    for (let page = 0; page < MAX_PAGES_PER_SCAN; page += 1) {
      const batch = await provider.incomingTransfers(purchase.receiver, cursor, PAGE_SIZE);
      for (const transfer of batch.transfers.filter((candidate) => candidate.memo === purchase.memo && SALE_MEMO_PATTERN.test(candidate.memo) && !isVanished(purchase, candidate))) {
        const problem = matchSaleTransfer(purchase, transfer);
        if (problem === null) {
          return this.#detect(purchase, transfer, batch.cursor);
        }
        await this.#noteProblem(purchase, transfer, problem);
      }
      if (batch.cursor === cursor) {
        break;
      }
      cursor = batch.cursor;
      await this.#repository.saveCursor(purchase.id, cursor);
    }
    return false;
  }

  /**
   * @param {import("../domain/Listing.js").Purchase} purchase
   * @param {import("../../payments/application/ports.js").Transfer} transfer
   * @param {number} cursor
   */
  async #detect(purchase, transfer, cursor) {
    const detected = await this.#unitOfWork(async () => {
      const moved = await this.#repository.transitionPurchase(purchase.id, PurchaseStatus.PENDING, PurchaseStatus.DETECTED, { paidBy: { txId: transfer.txId, opIndex: transfer.opIndex, blockNum: transfer.blockNum, time: transfer.time }, cursor });
      if (moved !== null) {
        await this.#audit.record({ actorKind: "system", action: "sales.payment_detected", targetKind: "purchase", targetId: purchase.id, details: { tx: transfer.txId, op: transfer.opIndex, from: transfer.from, to: transfer.to, amount: transfer.amount, asset: transfer.asset } });
      }
      return moved;
    });
    if (detected !== null) {
      await this.#tellAbout(purchase);
    }
    return detected !== null;
  }

  /**
   * @param {import("../domain/Listing.js").Purchase} purchase
   * @param {import("../../payments/application/ports.js").Transfer} transfer
   * @param {string} problem
   */
  async #noteProblem(purchase, transfer, problem) {
    this.#logger.warn("a transfer to a seller carries a purchase memo but does not pay it", { purchase: purchase.id, tx: transfer.txId, problem });
    await this.#unitOfWork(async () => {
      await this.#repository.setProblem(purchase.id, problem);
      const listing = await this.#repository.findListing(purchase.listingId);
      await this.#notifications.notify(purchase.buyerId, NotificationKind.SALE_PAYMENT_PROBLEM, { listingId: purchase.listingId, card: { definitionId: listing?.definitionId ?? null }, problem, account: purchase.receiver });
      await this.#audit.record({ actorKind: "system", action: "sales.payment_mismatch", targetKind: "purchase", targetId: purchase.id, details: { tx: transfer.txId, op: transfer.opIndex, from: transfer.from, to: transfer.to, amount: transfer.amount, asset: transfer.asset, problem } });
    });
    await this.#tellAbout(purchase);
  }

  /**
   * @param {import("../domain/Listing.js").Purchase} purchase DETECTED
   * @returns {Promise<boolean>} whether the sale completed now
   */
  async #confirm(purchase) {
    const paidBy = /** @type {import("../domain/Listing.js").PaidBy} */ (purchase.paidBy);
    const verdict = await this.#provider(purchase.network).confirm({
      network: purchase.network,
      txId: paidBy.txId,
      opIndex: paidBy.opIndex,
      blockNum: paidBy.blockNum,
      time: paidBy.time,
      from: purchase.payer,
      to: purchase.receiver,
      asset: purchase.asset,
      amount: purchase.amount,
      memo: purchase.memo,
    });
    if (verdict === "IRREVERSIBLE") {
      return this.#complete(purchase);
    }
    if (verdict === "MISSING") {
      await this.#unitOfWork(async () => {
        const back = await this.#repository.transitionPurchase(purchase.id, PurchaseStatus.DETECTED, PurchaseStatus.PENDING, { paidBy: null, cursor: purchase.startCursor, vanished: { txId: paidBy.txId, blockNum: paidBy.blockNum } });
        if (back !== null) {
          this.#logger.warn("a payment to a seller left the chain", { purchase: purchase.id, tx: paidBy.txId });
          await this.#audit.record({ actorKind: "system", action: "sales.payment_vanished", targetKind: "purchase", targetId: purchase.id, details: { tx: paidBy.txId } });
        }
      });
      await this.#tellAbout(purchase);
    }
    return false;
  }

  /**
   * The payment is final: the copy is the buyer's, and the sale goes on chain.
   * @param {import("../domain/Listing.js").Purchase} purchase
   */
  async #complete(purchase) {
    const listing = await this.#unitOfWork(async () => {
      const locked = await this.#repository.lockListing(purchase.listingId);
      const completed = await this.#repository.transitionPurchase(purchase.id, PurchaseStatus.DETECTED, PurchaseStatus.COMPLETED, { closedAt: this.#clock.now() });
      if (locked === null || completed === null) {
        return null;
      }
      if (locked.status !== ListingStatus.ACTIVE || !(await this.#repository.closeListing(locked.id, ListingStatus.SOLD, this.#clock.now()))) {
        throw new Error(`purchase ${purchase.id} was paid but its listing ${locked.id} is ${locked.status}`);
      }
      const [copy] = await this.#inventory.transfer({ fromId: locked.sellerId, toId: purchase.buyerId, instanceIds: [locked.cardInstanceId], ref: refOf(locked.id) });
      const paidBy = /** @type {import("../domain/Listing.js").PaidBy} */ (completed.paidBy);
      const price = `${this.#sales.formatPrice(purchase.amount, purchase.asset)} ${purchase.asset}`;
      const payload = saleRecord({ listingId: locked.id, seller: purchase.receiver, buyer: purchase.payer, card: { id: copy.id, definitionId: copy.definitionId, serial: copy.serial, finish: copy.finish }, price, txId: paidBy.txId });
      await this.#outbox.enqueueSale({ network: purchase.network, listingId: locked.id, payload });
      const sold = { listingId: locked.id, card: { definitionId: copy.definitionId, serial: copy.serial, finish: copy.finish }, price: this.#sales.formatPrice(purchase.amount, purchase.asset), asset: purchase.asset };
      await this.#notifications.notify(locked.sellerId, NotificationKind.SALE_SOLD, { ...sold, account: purchase.payer });
      await this.#notifications.notify(purchase.buyerId, NotificationKind.SALE_BOUGHT, { ...sold, account: purchase.receiver });
      await this.#audit.record({ actorKind: "system", action: "sales.completed", targetKind: "listing", targetId: locked.id, details: { purchase: purchase.id, copy: copy.id, from: purchase.receiver, to: purchase.payer, tx: paidBy.txId } });
      return locked;
    });
    if (listing === null) {
      return false;
    }
    this.#logger.info("card sold", { listing: listing.id, purchase: purchase.id });
    this.#sales.tell(listing.id, [listing.sellerId, purchase.buyerId]);
    return true;
  }

  /** @param {import("../domain/Listing.js").Purchase} purchase */
  async #expire(purchase) {
    const expired = await this.#unitOfWork(async () => {
      const closed = await this.#repository.transitionPurchase(purchase.id, PurchaseStatus.PENDING, PurchaseStatus.EXPIRED, { closedAt: this.#clock.now() });
      if (closed !== null) {
        const listing = await this.#repository.findListing(purchase.listingId);
        await this.#notifications.notify(purchase.buyerId, NotificationKind.SALE_RESERVATION_EXPIRED, { listingId: purchase.listingId, card: { definitionId: listing?.definitionId ?? null }, account: purchase.receiver });
        await this.#audit.record({ actorKind: "system", action: "sales.reservation_expired", targetKind: "purchase", targetId: purchase.id });
      }
      return closed;
    });
    if (expired !== null) {
      await this.#tellAbout(purchase);
    }
    return expired !== null;
  }

  /** @param {import("../domain/Listing.js").Purchase} purchase */
  async #tellAbout(purchase) {
    const listing = await this.#repository.findListing(purchase.listingId);
    this.#sales.tell(purchase.listingId, listing === null ? [purchase.buyerId] : [listing.sellerId, purchase.buyerId]);
  }

  /**
   * @param {string} userId
   * @param {unknown} purchaseId
   */
  async #ownPurchase(userId, purchaseId) {
    const purchase = isUuid(purchaseId) ? await this.#repository.findPurchase(/** @type {string} */ (purchaseId)) : null;
    if (purchase === null || purchase.buyerId !== userId) {
      throw new AppError("NOT_FOUND", "no such purchase");
    }
    return purchase;
  }

  /** @param {string} network */
  #provider(network) {
    const provider = this.#providers.get(network);
    if (provider === undefined) {
      throw new Error(`no payment provider for ${network}`);
    }
    return provider;
  }
}

/**
 * The transfer that left the chain, as a lagging node's history may still show it (the same transaction re-included in another block pays again).
 * @param {import("../domain/Listing.js").Purchase} purchase
 * @param {import("../../payments/application/ports.js").Transfer} transfer
 */
const isVanished = (purchase, transfer) => purchase.vanished !== null && purchase.vanished.txId === transfer.txId && purchase.vanished.blockNum === transfer.blockNum;
