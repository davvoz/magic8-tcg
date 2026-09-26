/**
 * PaymentSettlement: turns transfers seen on chains into paid orders
 * (docs/tcg/01-architettura.md §8.2). A job runs it every few seconds; a
 * player's payment hint only makes it run sooner.
 *
 *   poll     shop history → each new transfer is recorded once and matched to
 *            the order its memo names: PAYMENT_PENDING → PAYMENT_DETECTED, or
 *            a problem (wrong amount, sender, asset, late, unknown memo…)
 *   confirm  detected payments whose block is irreversible on a quorum of
 *            nodes: the order becomes PAYMENT_VERIFIED; a problem payment is
 *            queued for refund. A payment that left the chain (micro-fork)
 *            is dropped and its order waits for payment again.
 *
 * A buyer whose payment must be refunded hears of it in their notification
 * feed (docs/tcg/15-notifiche.md).
 *
 * Fulfilment (VERIFIED → FULFILLED) is a separate step, so a fulfilment bug
 * never loses a verified payment. Everything is idempotent and every state
 * change is compare-and-set: several server processes may run it at once.
 */
import { AppError } from "../../../kernel/AppError.js";
import { isUuid } from "../../../kernel/random.js";
import { NotificationKind } from "../../notifications/index.js";
import { OrderStatus } from "../domain/Order.js";
import { MatchProblem, isOrderMemo, matchTransfer } from "../domain/PaymentMatch.js";

const TX_ID_PATTERN = /^[0-9a-f]{40}$/;
const PAGE_SIZE = 100;
const MAX_PAGES_PER_POLL = 20;
const CONFIRM_BATCH = 50;
const HINT_COOLDOWN_MS = 3000;

export class PaymentSettlement {
  #orders;
  #payments;
  #providers;
  #receiverFor;
  #audit;
  #notifications;
  #formatAmount;
  #clock;
  #unitOfWork;
  #logger;
  /** @type {Map<string, number>} network → last hint-triggered run */
  #lastHintRun = new Map();

  /**
   * @param {{
   *   orders: import("./ports.js").MarketplaceRepository,
   *   payments: import("../../payments/index.js").PaymentService,
   *   providers: ReadonlyMap<string, import("../../payments/application/ports.js").PaymentProvider>,
   *   receiverFor: (network: string) => string,
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   notifications: { notify: (userId: string, kind: string, data: Record<string, unknown>) => Promise<unknown> },
   *   formatAmount: (units: number, asset: string) => string,
   *   clock: import("../../../kernel/time.js").Clock,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   logger: import("../../../kernel/logger.js").Logger,
   * }} deps
   */
  constructor({ orders, payments, providers, receiverFor, audit, notifications, formatAmount, clock, unitOfWork, logger }) {
    this.#orders = orders;
    this.#payments = payments;
    this.#providers = providers;
    this.#receiverFor = receiverFor;
    this.#audit = audit;
    this.#notifications = notifications;
    this.#formatAmount = formatAmount;
    this.#clock = clock;
    this.#unitOfWork = unitOfWork;
    this.#logger = logger;
  }

  /** One pass over every network: detect, then confirm. */
  async runOnce() {
    for (const network of this.#providers.keys()) {
      await this.poll(network);
      await this.confirm(network);
    }
  }

  /**
   * Reads new transfers to the shop account of `network`.
   * @param {string} network
   * @returns {Promise<number>} transfers recorded for the first time
   */
  async poll(network) {
    const provider = this.#provider(network);
    const receiver = this.#receiverFor(network);
    const cursorName = `payments:${network}:${receiver}`;
    let cursor = await this.#payments.cursor(cursorName);
    if (cursor === null) {
      // First run: start after the shop's newest entry; no order can predate this server.
      await this.#payments.saveCursor(cursorName, network, await provider.latestCursor(receiver));
      return 0;
    }
    let recorded = 0;
    for (let page = 0; page < MAX_PAGES_PER_POLL; page += 1) {
      const batch = await provider.incomingTransfers(receiver, cursor, PAGE_SIZE);
      for (const transfer of batch.transfers) {
        recorded += (await this.#accept(transfer)) ? 1 : 0;
      }
      if (batch.cursor === cursor) {
        break;
      }
      cursor = batch.cursor;
      await this.#payments.saveCursor(cursorName, network, cursor);
    }
    return recorded;
  }

  /**
   * Settles detected payments whose fate the chain has decided.
   * @param {string} network
   * @returns {Promise<{ verified: number, refunds: number, vanished: number }>}
   */
  async confirm(network) {
    const provider = this.#provider(network);
    const outcome = { verified: 0, refunds: 0, vanished: 0 };
    for (const payment of await this.#payments.detected(network, CONFIRM_BATCH)) {
      const verdict = await provider.confirm(payment);
      if (verdict === "IRREVERSIBLE" && payment.problem === null) {
        outcome.verified += (await this.#verify(payment)) ? 1 : 0;
      } else if (verdict === "IRREVERSIBLE") {
        outcome.refunds += (await this.#refund(payment)) ? 1 : 0;
      } else if (verdict === "MISSING") {
        outcome.vanished += (await this.#vanish(payment)) ? 1 : 0;
      }
    }
    return outcome;
  }

  /**
   * The player says they paid: look sooner. The transaction id is not
   * trusted for anything; the chain is read as always (T6).
   * @param {{ userId: string, orderId: unknown, txId: unknown }} hint
   */
  async hint({ userId, orderId, txId }) {
    if (typeof txId !== "string" || !TX_ID_PATTERN.test(txId)) {
      throw new AppError("VALIDATION", "txId must be a transaction id (40 hex characters)");
    }
    const order = isUuid(orderId) ? await this.#orders.findOrder(/** @type {string} */ (orderId)) : null;
    if (order === null || order.userId !== userId) {
      throw new AppError("NOT_FOUND", "no such order");
    }
    const now = this.#clock.now();
    if (now - (this.#lastHintRun.get(order.network) ?? Number.NEGATIVE_INFINITY) >= HINT_COOLDOWN_MS) {
      this.#lastHintRun.set(order.network, now);
      await this.poll(order.network);
      await this.confirm(order.network);
    }
    return /** @type {import("../domain/Order.js").Order} */ (await this.#orders.findOrder(order.id));
  }

  /**
   * @param {import("../../payments/application/ports.js").Transfer} transfer
   * @returns {Promise<boolean>} whether the transfer was new
   */
  async #accept(transfer) {
    const order = isOrderMemo(transfer.memo) ? await this.#orders.findByMemo(transfer.memo) : null;
    const problem = matchTransfer(order, transfer);
    return this.#unitOfWork(async () => {
      const { payment, isNew } = await this.#payments.record(transfer, { orderId: order?.id ?? null, problem });
      if (!isNew) {
        return false;
      }
      let finalProblem = problem;
      if (problem === null && order !== null) {
        const detected = await this.#orders.transition(order.id, order.status, OrderStatus.PAYMENT_DETECTED, { at: this.#clock.now(), paymentId: payment.id });
        if (detected === null) {
          // The order changed between reading and updating (cancelled, paid by an earlier transfer…).
          finalProblem = MatchProblem.ORDER_NOT_PAYABLE;
          await this.#payments.markProblem(payment.id, finalProblem);
        }
      }
      await this.#audit.record({
        actorKind: "system",
        action: "payments.transfer_detected",
        targetKind: "payment",
        targetId: payment.id,
        details: { network: transfer.network, tx: transfer.txId, op: transfer.opIndex, from: transfer.from, amount: transfer.amount, asset: transfer.asset, order: order?.id ?? null, problem: finalProblem },
      });
      return true;
    });
  }

  /** @param {import("../../payments/application/ports.js").Payment} payment */
  #verify(payment) {
    return this.#unitOfWork(async () => {
      if ((await this.#payments.apply(payment.id)) === null) {
        return false;
      }
      const order = await this.#orders.transition(/** @type {string} */ (payment.orderId), OrderStatus.PAYMENT_DETECTED, OrderStatus.PAYMENT_VERIFIED, { at: this.#clock.now() });
      if (order === null) {
        throw new Error(`payment ${payment.id} applied but its order ${payment.orderId} was not awaiting verification`);
      }
      await this.#audit.record({ actorKind: "system", action: "marketplace.payment_verified", targetKind: "order", targetId: order.id, details: { payment: payment.id, tx: payment.txId } });
      return true;
    });
  }

  /** @param {import("../../payments/application/ports.js").Payment} payment */
  #refund(payment) {
    return this.#unitOfWork(async () => {
      if ((await this.#payments.requireRefund(payment)) === null) {
        return false;
      }
      this.#logger.warn("payment needs a refund", { payment: payment.id, problem: payment.problem, from: payment.from, amount: payment.amount, asset: payment.asset });
      const order = payment.orderId === null ? null : await this.#orders.findOrder(payment.orderId);
      if (order !== null) {
        await this.#notifications.notify(order.userId, NotificationKind.ORDER_REFUND, { orderId: order.id, amount: this.#formatAmount(payment.amount, payment.asset), asset: payment.asset, problem: payment.problem });
      }
      await this.#audit.record({ actorKind: "system", action: "payments.refund_required", targetKind: "payment", targetId: payment.id, details: { problem: payment.problem, to: payment.from, amount: payment.amount, asset: payment.asset, order: payment.orderId } });
      return true;
    });
  }

  /** @param {import("../../payments/application/ports.js").Payment} payment */
  #vanish(payment) {
    return this.#unitOfWork(async () => {
      if ((await this.#payments.vanish(payment.id)) === null) {
        return false;
      }
      if (payment.problem === null && payment.orderId !== null) {
        await this.#orders.transition(payment.orderId, OrderStatus.PAYMENT_DETECTED, OrderStatus.PAYMENT_PENDING, { at: this.#clock.now(), paymentId: null });
      }
      this.#logger.warn("a detected payment left the chain", { payment: payment.id, tx: payment.txId });
      await this.#audit.record({ actorKind: "system", action: "payments.transfer_vanished", targetKind: "payment", targetId: payment.id, details: { tx: payment.txId, order: payment.orderId } });
      return true;
    });
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
