/**
 * PaymentService: the ledger of transfers seen on chains. It records each
 * transfer once, moves payments through their states with compare-and-set,
 * and queues refunds. It knows nothing about orders: the marketplace decides
 * what a transfer pays and tells the ledger.
 */
import { assertImplements } from "../../../kernel/contracts.js";
import { uuidV4 } from "../../../kernel/random.js";
import { PaymentProblem, PaymentStatus } from "../domain/Payment.js";
import { PAYMENT_REPOSITORY_METHODS } from "./ports.js";

export class PaymentService {
  #repository;
  #random;
  #clock;
  #unitOfWork;

  /**
   * @param {{
   *   repository: import("./ports.js").PaymentRepository,
   *   random: import("../../../kernel/random.js").SecureRandom,
   *   clock: import("../../../kernel/time.js").Clock,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   * }} deps
   */
  constructor({ repository, random, clock, unitOfWork }) {
    assertImplements(repository, PAYMENT_REPOSITORY_METHODS, "PaymentRepository");
    this.#repository = repository;
    this.#random = random;
    this.#clock = clock;
    this.#unitOfWork = unitOfWork;
  }

  /**
   * Records a transfer once. A transfer seen again after it vanished (it was
   * re-included in a later block) comes back to life with its new block.
   * @param {import("../domain/Payment.js").Transfer} transfer
   * @param {{ orderId: string | null, problem: string | null }} match what the marketplace decided it pays
   * @returns {Promise<Readonly<{ payment: import("../domain/Payment.js").Payment, isNew: boolean }>>}
   */
  record(transfer, { orderId, problem }) {
    return this.#unitOfWork(async () => {
      /** @type {import("../domain/Payment.js").Payment} */
      const candidate = Object.freeze({ ...transfer, id: uuidV4(this.#random), orderId, status: PaymentStatus.DETECTED, problem, observedAt: this.#clock.now(), irreversibleAt: null });
      if (await this.#repository.insert(candidate)) {
        return Object.freeze({ payment: candidate, isNew: true });
      }
      const existing = /** @type {import("../domain/Payment.js").Payment} */ (await this.#repository.findByTransfer(transfer.network, transfer.txId, transfer.opIndex));
      if (existing.status === PaymentStatus.IGNORED && existing.problem === PaymentProblem.VANISHED) {
        const revived = await this.#repository.transition(existing.id, PaymentStatus.IGNORED, PaymentStatus.DETECTED, { orderId, problem, blockNum: transfer.blockNum });
        if (revived !== null) {
          return Object.freeze({ payment: revived, isNew: true });
        }
      }
      return Object.freeze({ payment: existing, isNew: false });
    });
  }

  /**
   * @param {string} id
   * @param {string} problem the transfer turned out to pay nothing after all (e.g. the order changed meanwhile)
   */
  async markProblem(id, problem) {
    return this.#repository.transition(id, PaymentStatus.DETECTED, PaymentStatus.DETECTED, { problem });
  }

  /** @param {string} id irreversible and applied to its order */
  apply(id) {
    return this.#repository.transition(id, PaymentStatus.DETECTED, PaymentStatus.APPLIED, { irreversibleAt: this.#clock.now() });
  }

  /**
   * Irreversible but paying nothing: the whole transfer goes back to its sender.
   * @param {import("../domain/Payment.js").Payment} payment
   */
  requireRefund(payment) {
    return this.#unitOfWork(async () => {
      const moved = await this.#repository.transition(payment.id, PaymentStatus.DETECTED, PaymentStatus.REFUND_REQUIRED, { irreversibleAt: this.#clock.now() });
      if (moved !== null) {
        await this.#repository.insertRefund({ id: uuidV4(this.#random), paymentId: payment.id, toAccount: payment.from, asset: payment.asset, amount: payment.amount, at: this.#clock.now() });
      }
      return moved;
    });
  }

  /** @param {string} id the transfer is no longer on the chain */
  vanish(id) {
    return this.#repository.transition(id, PaymentStatus.DETECTED, PaymentStatus.IGNORED, { problem: PaymentProblem.VANISHED });
  }

  /** @param {string} id */
  find(id) {
    return this.#repository.find(id);
  }

  /**
   * @param {string} network
   * @param {number} limit
   */
  detected(network, limit) {
    return this.#repository.listDetected(network, limit);
  }

  /** @param {number} [limit] refunds an operator still has to send */
  pendingRefunds(limit = 100) {
    return this.#repository.listPendingRefunds(limit);
  }

  /**
   * @param {readonly string[]} statuses
   * @param {number} limit
   */
  refunds(statuses, limit) {
    return this.#repository.listRefunds(statuses, limit);
  }

  /** @param {string} name */
  cursor(name) {
    return this.#repository.getCursor(name);
  }

  /**
   * @param {string} name
   * @param {string} network
   * @param {number} position
   */
  saveCursor(name, network, position) {
    return this.#repository.setCursor(name, network, position, this.#clock.now());
  }
}
