/**
 * AdminService: what operators see and do (docs/tcg/07-runbook.md).
 *
 * An operator is a signed-in user whose chain account is listed in
 * M8_ADMIN_ACCOUNTS; everyone else gets FORBIDDEN, and every admin action is
 * recorded in the audit log with who did it. Operators never move money
 * through the server: a refund is paid with Keychain from the shop account
 * and closed by the RefundWatcher when the chain shows it. What they can
 * change here is limited to acknowledging chain alerts.
 */
import { AppError } from "../../../kernel/AppError.js";
import { refundMemo } from "../../payments/index.js";

const MAX_LIST = 200;

export class AdminService {
  #admins;
  #readModel;
  #chainRepository;
  #payments;
  #audit;
  #runtime;
  #shopFor;
  #formatAmount;
  #clock;

  /**
   * @param {{
   *   admins: Readonly<Record<string, readonly string[]>>,
   *   readModel: import("../infrastructure/PgOperationsReadModel.js").PgOperationsReadModel,
   *   chainRepository: import("../../chain/index.js").PgChainRepository,
   *   payments: import("../../payments/index.js").PaymentService,
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   runtime: () => Readonly<Record<string, unknown>>,
   *   shopAccount: (network: string) => string,
   *   formatAmount: (units: number, asset: string) => string,
   *   clock: import("../../../kernel/time.js").Clock,
   * }} deps `runtime`: in-memory state (connections, broadcasters' resource credits)
   */
  constructor({ admins, readModel, chainRepository, payments, audit, runtime, shopAccount, formatAmount, clock }) {
    this.#admins = admins;
    this.#readModel = readModel;
    this.#chainRepository = chainRepository;
    this.#payments = payments;
    this.#audit = audit;
    this.#runtime = runtime;
    this.#shopFor = shopAccount;
    this.#formatAmount = formatAmount;
    this.#clock = clock;
  }

  /**
   * @param {{ user: { id: string, network: string, account: string } } | null} principal
   * @returns {{ id: string, network: string, account: string }}
   */
  requireAdmin(principal) {
    const user = principal?.user;
    if (user === undefined || !(this.#admins[user.network] ?? []).includes(user.account)) {
      throw new AppError("FORBIDDEN", "operators only");
    }
    return user;
  }

  async overview() {
    return Object.freeze({ at: this.#clock.now(), ...(await this.#readModel.overview()), runtime: this.#runtime() });
  }

  alerts() {
    return this.#chainRepository.listAlerts(MAX_LIST);
  }

  /**
   * @param {{ id: string }} admin
   * @param {number} alertId
   * @param {string} note why it is resolved (what was checked or done)
   * @param {string} ip
   */
  async resolveAlert(admin, alertId, note, ip) {
    const resolved = await this.#chainRepository.resolveAlert(alertId, this.#clock.now());
    if (resolved === null) {
      throw new AppError("NOT_FOUND", "no open alert with this id");
    }
    await this.#audit.record({ actorKind: "admin", actorUserId: admin.id, action: "admin.alert_resolved", targetKind: "chain_alert", targetId: String(alertId), ip, details: { ...resolved, note } });
    return resolved;
  }

  /** Open refunds, with exactly what the operator must send (the memo closes the refund once the chain shows it). */
  async refunds() {
    const open = await this.#payments.refunds(["PENDING", "SENT"], MAX_LIST);
    return Object.freeze(open.map((refund) => Object.freeze({ ...refund, from: this.#shopFor(refund.network), memo: refundMemo(refund.id), amountText: this.#formatAmount(refund.amount, refund.asset) })));
  }

  /** @param {{ action?: string, targetId?: string, beforeSeq?: number, limit?: number }} filter */
  audit(filter) {
    return this.#readModel.audit({ ...filter, limit: Math.min(filter.limit ?? 50, MAX_LIST) });
  }

  /** @returns {Promise<Readonly<{ intact: boolean, firstBrokenSeq: number | null }>>} */
  async verifyAudit() {
    const broken = await this.#audit.verify();
    return Object.freeze({ intact: broken === null, firstBrokenSeq: broken });
  }
}
