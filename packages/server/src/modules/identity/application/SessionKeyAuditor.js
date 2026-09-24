/**
 * Revokes sessions whose login key is no longer an authorised posting key of
 * the account (threat T18: a user who notices a compromised key rotates it on
 * chain; sessions opened with the old key must die with it). Run periodically.
 * If the chain cannot be read, nothing is revoked: availability problems must
 * not log everyone out.
 */
import { RevokeReason } from "../domain/Session.js";

const REVOKING_ERRORS = Object.freeze(new Set(["KEY_NOT_AUTHORIZED", "ACCOUNT_NOT_FOUND"]));

export class SessionKeyAuditor {
  #wallets;
  #users;
  #sessions;
  #audit;
  #clock;
  #batchSize;
  #unitOfWork;

  /**
   * @param {{
   *   wallets: ReadonlyMap<string, import("./ports.js").WalletProvider>,
   *   users: import("./ports.js").UserRepository,
   *   sessions: import("./ports.js").SessionRepository,
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   clock: import("../../../kernel/time.js").Clock,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   batchSize?: number,
   * }} deps
   */
  constructor({ wallets, users, sessions, audit, clock, unitOfWork, batchSize = 500 }) {
    this.#unitOfWork = unitOfWork;
    this.#wallets = wallets;
    this.#users = users;
    this.#sessions = sessions;
    this.#audit = audit;
    this.#clock = clock;
    this.#batchSize = batchSize;
  }

  /**
   * Walks every active (user, key) pair, one page at a time.
   * @returns {Promise<{ checked: number, revoked: number, skipped: number }>}
   */
  async run() {
    const totals = { checked: 0, revoked: 0, skipped: 0 };
    /** @type {{ userId: string, loginPublicKey: string } | null} */
    let after = null;
    for (;;) {
      const pairs = await this.#sessions.listActiveLoginKeys(this.#clock.now(), this.#batchSize, after);
      for (const { userId, loginPublicKey } of pairs) {
        const outcome = await this.#check(userId, loginPublicKey);
        totals.revoked += outcome.revoked;
        totals.skipped += outcome.skipped ? 1 : 0;
      }
      totals.checked += pairs.length;
      if (pairs.length < this.#batchSize) {
        return totals;
      }
      after = pairs[pairs.length - 1];
    }
  }

  /**
   * @param {string} userId
   * @param {string} publicKey
   */
  async #check(userId, publicKey) {
    const user = await this.#users.findById(userId);
    const wallet = user === null ? undefined : this.#wallets.get(user.network);
    if (user === null || wallet === undefined) {
      return { revoked: 0, skipped: true };
    }
    const result = await wallet.isPostingKey(user.account, publicKey);
    if (result.ok || !REVOKING_ERRORS.has(result.error.code)) {
      return { revoked: 0, skipped: !result.ok };
    }
    const count = await this.#unitOfWork(async () => {
      const revoked = await this.#sessions.revokeByLoginKey(userId, publicKey, RevokeReason.KEY_REMOVED, this.#clock.now());
      await this.#audit.record({ actorKind: "system", action: "auth.sessions_revoked", targetKind: "user", targetId: userId, details: { reason: RevokeReason.KEY_REMOVED, publicKey, count: revoked } });
      return revoked;
    });
    return { revoked: count, skipped: false };
  }
}
