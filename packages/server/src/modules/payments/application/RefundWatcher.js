/**
 * RefundWatcher: closes refunds from what the chain shows, never from what
 * an operator says (docs/tcg/07-runbook.md).
 *
 * The operator pays a refund with Keychain from the shop account, with the
 * memo `m8tcg refund <refund id>`. The watcher reads the shop's outgoing
 * transfers from its own cursor: a transfer with that memo, to the right
 * account, of exactly the right asset and amount marks the refund SENT; it
 * becomes CONFIRMED once independent nodes place it below the irreversible
 * block (like an incoming payment), or goes back to PENDING if it vanished.
 * A transfer that does not match, or pays a refund twice, is recorded in
 * the audit log and logged as an error: a human must look at it.
 */
const REFUND_MEMO = /^m8tcg refund ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const PAGE_SIZE = 500;
const MAX_PAGES = 10;
const CONFIRM_BATCH = 50;

/**
 * The memo that pays refund `id`.
 * @param {string} id
 */
export const refundMemo = (id) => `m8tcg refund ${id}`;

export class RefundWatcher {
  #repository;
  #providers;
  #senderFor;
  #audit;
  #clock;
  #logger;

  /**
   * @param {{
   *   repository: import("./ports.js").PaymentRepository,
   *   providers: ReadonlyMap<string, import("./ports.js").PaymentProvider>,
   *   senderFor: (network: string) => string,
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   clock: import("../../../kernel/time.js").Clock,
   *   logger: import("../../../kernel/logger.js").Logger,
   * }} deps
   */
  constructor({ repository, providers, senderFor, audit, clock, logger }) {
    this.#repository = repository;
    this.#providers = providers;
    this.#senderFor = senderFor;
    this.#audit = audit;
    this.#clock = clock;
    this.#logger = logger;
  }

  /** One round on every network: detect new refund transfers, then confirm sent ones. */
  async runOnce() {
    for (const network of this.#providers.keys()) {
      await this.poll(network);
      await this.confirm(network);
    }
  }

  /**
   * @param {string} network
   * @returns {Promise<number>} refunds marked SENT
   */
  async poll(network) {
    const provider = /** @type {import("./ports.js").PaymentProvider} */ (this.#providers.get(network));
    const sender = this.#senderFor(network);
    const cursorName = `refunds:${network}:${sender}`;
    let cursor = await this.#repository.getCursor(cursorName);
    if (cursor === null) {
      await this.#repository.setCursor(cursorName, network, await provider.latestCursor(sender), this.#clock.now());
      return 0;
    }
    let sent = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const batch = await provider.outgoingTransfers(sender, cursor, PAGE_SIZE);
      for (const transfer of batch.transfers) {
        sent += (await this.#observe(transfer)) ? 1 : 0;
      }
      if (batch.cursor === cursor) {
        break;
      }
      cursor = batch.cursor;
      await this.#repository.setCursor(cursorName, network, cursor, this.#clock.now());
    }
    return sent;
  }

  /**
   * @param {import("./ports.js").Transfer} transfer
   * @returns {Promise<boolean>} true when it paid a pending refund
   */
  async #observe(transfer) {
    const id = REFUND_MEMO.exec(transfer.memo)?.[1];
    if (id === undefined) {
      return false;
    }
    const found = await this.#repository.findRefund(id);
    const refund = found !== null && found.network === transfer.network ? found : null;
    const where = { txId: transfer.txId, to: transfer.to, asset: transfer.asset, amount: transfer.amount };
    if (refund === null) {
      await this.#flag("payments.refund_unknown", id, where);
      return false;
    }
    if (refund.transfer !== null && refund.transfer.txId !== transfer.txId) {
      await this.#flag("payments.refund_paid_twice", id, { ...where, first: refund.transfer.txId });
      return false;
    }
    if (transfer.to !== refund.toAccount || transfer.asset !== refund.asset || transfer.amount !== refund.amount) {
      await this.#flag("payments.refund_mismatch", id, { ...where, expected: { to: refund.toAccount, asset: refund.asset, amount: refund.amount } });
      return false;
    }
    const marked = await this.#repository.markRefundSent(id, transfer, this.#clock.now());
    if (marked !== null) {
      await this.#audit.record({ actorKind: "system", action: "payments.refund_sent", targetKind: "refund", targetId: id, details: where });
    }
    return marked !== null;
  }

  /**
   * @param {string} network
   * @returns {Promise<number>} refunds confirmed
   */
  async confirm(network) {
    const provider = /** @type {import("./ports.js").PaymentProvider} */ (this.#providers.get(network));
    const sender = this.#senderFor(network);
    let confirmed = 0;
    const sent = (await this.#repository.listRefunds(["SENT"], CONFIRM_BATCH)).filter((refund) => refund.network === network);
    for (const refund of sent) {
      const transfer = /** @type {NonNullable<typeof refund.transfer>} */ (refund.transfer);
      const verdict = await provider.confirm({ network, ...transfer, from: sender, to: refund.toAccount, asset: refund.asset, amount: refund.amount, memo: refundMemo(refund.id) });
      if (verdict === "IRREVERSIBLE") {
        await this.#repository.confirmRefund(refund.id, this.#clock.now());
        await this.#audit.record({ actorKind: "system", action: "payments.refund_confirmed", targetKind: "refund", targetId: refund.id, details: { txId: transfer.txId } });
        confirmed += 1;
      } else if (verdict === "MISSING") {
        await this.#repository.reopenRefund(refund.id, this.#clock.now());
        this.#logger.warn("a refund transfer vanished from the chain; the refund is pending again", { refund: refund.id, txId: transfer.txId });
      }
    }
    return confirmed;
  }

  /**
   * @param {string} action
   * @param {string} refundId
   * @param {Readonly<Record<string, unknown>>} details
   */
  async #flag(action, refundId, details) {
    this.#logger.error(`refund transfer needs attention: ${action}`, { refund: refundId, ...details });
    await this.#audit.record({ actorKind: "system", action, targetKind: "refund", targetId: refundId, details });
  }
}
