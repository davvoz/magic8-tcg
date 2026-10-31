/**
 * WalletExport: hands a player who signed in with Google the keys of the
 * account KIJAM keeps for them (docs/tcg/29-google.md), so they can take it
 * anywhere. Only for a Google session, and only after the player signed in
 * at Google again in the last ten minutes: a session left open on someone
 * else's computer does not give the keys away. Every export is audited and
 * remembered (exported_at); the keys are never logged.
 */
import { AppError } from "../../../kernel/AppError.js";

const GOOGLE_METHOD = "google";

/**
 * @typedef {Readonly<{ account: string, masterPassword: string, owner: string, active: string, posting: string, memo: string }>} ExportedWallet
 */

export class WalletExport {
  #custody;
  #repository;
  #audit;
  #clock;

  /**
   * @param {{
   *   custody: Pick<import("./KeyCustody.js").KeyCustody, "keysOf">,
   *   repository: Pick<import("./ports.js").CustodyRepository, "markExported">,
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   clock: import("../../../kernel/time.js").Clock,
   * }} deps
   */
  constructor({ custody, repository, audit, clock }) {
    this.#custody = custody;
    this.#repository = repository;
    this.#audit = audit;
    this.#clock = clock;
  }

  /**
   * @param {{ principal: Readonly<{ user: import("./ports.js").Player, session: Readonly<{ method?: string }> }>, reauthenticatedUserId: string | null, ip: string }} request
   *   `reauthenticatedUserId`: who signed in at Google again in the last ten minutes, if anyone
   * @returns {Promise<ExportedWallet>}
   */
  async export({ principal, reauthenticatedUserId, ip }) {
    const { user, session } = principal;
    if (session.method !== GOOGLE_METHOD) {
      throw new AppError("FORBIDDEN", "you signed in with your own keys: you hold them already");
    }
    if (reauthenticatedUserId !== user.id) {
      throw new AppError("REAUTH_REQUIRED", "sign in with Google again to export your wallet");
    }
    const kept = await this.#custody.keysOf(user.id);
    if (kept === null || kept.account !== user.account) {
      throw new AppError("FORBIDDEN", "KIJAM keeps no wallet for this account");
    }
    await this.#repository.markExported(user.id, this.#clock.now());
    await this.#audit.record({ actorKind: "user", actorUserId: user.id, action: "custody.exported", targetKind: "account", targetId: `${user.network}:${user.account}`, ip });
    const { masterPassword, owner, active, posting, memo } = kept.keys;
    return Object.freeze({ account: kept.account, masterPassword, owner, active, posting, memo });
  }
}
