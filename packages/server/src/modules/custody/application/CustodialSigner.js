/**
 * CustodialSigner: what the server signs for the accounts it keeps
 * (docs/tcg/29-google.md), in place of the player's browser.
 *
 * - Only for a session opened with Google, of a user whose keys are kept:
 *   a player who signed in with their own keys pays with those (20).
 * - transfer: only one that pays exactly a payment the game asked this
 *   player for and that is still open (a shop order, a reservation of the
 *   player market). Each payment reference is signed once: the claim is
 *   written before the broadcast, released only when the chain refused it.
 * - signMessage: only the authorisation of a game's session key (12).
 * - ping: a comment built and signed here, then relayed through the same
 *   checks as the pings browsers sign (26).
 *
 * The keys are opened for one signature and never logged; every signature
 * goes to the audit trail (custody.*).
 */
import { AppError } from "../../../kernel/AppError.js";
import { assertImplements } from "../../../kernel/contracts.js";
import { paysExactly, sessionAuthorizationOf } from "../domain/signable.js";
import { CHAIN_ACCESS_METHODS, PAYMENT_SOURCE_METHODS, SIGNING_KEYRING_METHODS } from "./ports.js";

const GOOGLE_METHOD = "google";
/** How long a transaction signed here may wait to be included (the browsers' wallets use the same). */
const EXPIRATION_SECONDS = 60;
/** Failures after which nobody can tell whether the transfer reached the chain. */
const UNCERTAIN = Object.freeze(["CHAIN_UNAVAILABLE", "INTERNAL"]);

/**
 * @typedef {Readonly<{ user: import("./ports.js").Player, session: Readonly<{ method?: string }> }>} Principal
 */

export class CustodialSigner {
  #custody;
  #keyrings;
  #payments;
  #chain;
  #pings;
  #repository;
  #audit;
  #clock;

  /**
   * @param {{
   *   custody: Pick<import("./KeyCustody.js").KeyCustody, "keysOf">,
   *   keyrings: ReadonlyMap<string, import("./ports.js").SigningKeyring>,
   *   payments: readonly import("./ports.js").PaymentSource[],
   *   chain: import("./ports.js").ChainAccess,
   *   pings: import("./ports.js").PingRelay | null,
   *   repository: import("./ports.js").CustodyRepository,
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   clock: import("../../../kernel/time.js").Clock,
   * }} deps `payments`: where open payments are found (the shop, the player market); `pings`: none when pings are off
   */
  constructor({ custody, keyrings, payments, chain, pings, repository, audit, clock }) {
    for (const [network, keyring] of keyrings) {
      assertImplements(keyring, SIGNING_KEYRING_METHODS, `keyring "${network}"`);
    }
    payments.forEach((source, index) => assertImplements(source, PAYMENT_SOURCE_METHODS, `payment source ${index}`));
    assertImplements(chain, CHAIN_ACCESS_METHODS, "ChainAccess");
    this.#custody = custody;
    this.#keyrings = keyrings;
    this.#payments = payments;
    this.#chain = chain;
    this.#pings = pings;
    this.#repository = repository;
    this.#audit = audit;
    this.#clock = clock;
  }

  /**
   * Pays an open payment from the kept account.
   * @param {{ principal: Principal, transfer: import("./ports.js").TransferRequest, ip: string }} request
   * @returns {Promise<string>} the transaction id
   */
  async transfer({ principal, transfer, ip }) {
    const { user } = principal;
    const kept = await this.#keptFor(principal);
    if (transfer.from !== kept.account || !paysExactly(await this.#openPayment(user.id, transfer.memo), { ...transfer, network: kept.network }, this.#clock.now())) {
      throw new AppError("PAYMENT_NOT_OPEN", "this transfer does not pay anything the game is waiting for");
    }
    if (!(await this.#repository.claimTransfer(transfer.memo, user.id, this.#clock.now()))) {
      throw new AppError("ALREADY_PAID", "this payment was already sent", { txId: await this.#repository.transferOf(transfer.memo) });
    }
    let signed;
    try {
      const reference = await this.#chain.chainReference(user);
      signed = kept.keyring.signTransfer({ reference, expirationSeconds: EXPIRATION_SECONDS, transfer }, kept.keys.active);
      await this.#repository.recordTransfer(transfer.memo, signed.txId);
    } catch (error) {
      // Nothing was sent.
      await this.#repository.releaseTransfer(transfer.memo);
      throw error;
    }
    try {
      await this.#chain.relayTransfer(user, signed.transaction, ip);
    } catch (error) {
      throw await this.#relayFailure(error, transfer.memo, signed.txId);
    }
    await this.#record(user, "custody.transfer_signed", ip, { txId: signed.txId, to: transfer.to, amount: transfer.amount, asset: transfer.asset, memo: transfer.memo });
    return signed.txId;
  }

  /**
   * Signs the authorisation of a game's session key with the posting key.
   * @param {{ principal: Principal, message: unknown, ip: string }} request
   * @returns {Promise<string>} the signature
   */
  async signMessage({ principal, message, ip }) {
    const kept = await this.#keptFor(principal);
    const authorization = sessionAuthorizationOf(message);
    if (authorization === null) {
      throw new AppError("FORBIDDEN", "the wallet kept by KIJAM signs only a game's session key");
    }
    const signature = kept.keyring.signMessage(/** @type {string} */ (message), kept.keys.posting);
    await this.#record(principal.user, "custody.session_authorized", ip, { gameId: authorization.gameId });
    return signature;
  }

  /**
   * Publishes a ping from the kept account, through the pings' own checks.
   * @param {{ principal: Principal, comment: Omit<import("./ports.js").CommentRequest, "author">, ip: string }} request
   * @returns {Promise<string>} the transaction id
   */
  async ping({ principal, comment, ip }) {
    if (this.#pings === null) {
      throw new AppError("NOT_FOUND", "pings are not offered here");
    }
    const kept = await this.#keptFor(principal);
    const reference = await this.#chain.chainReference(principal.user);
    const { transaction } = kept.keyring.signComment({ reference, expirationSeconds: EXPIRATION_SECONDS, comment: { ...comment, author: kept.account } }, kept.keys.posting);
    const txId = await this.#pings.relay(principal.user, transaction, ip);
    await this.#record(principal.user, "custody.ping_signed", ip, { txId });
    return txId;
  }

  /**
   * The kept keys of the signed-in player, when they signed in with Google.
   * @param {Principal} principal
   */
  async #keptFor({ user, session }) {
    if (session.method !== GOOGLE_METHOD) {
      throw new AppError("FORBIDDEN", "you signed in with your own keys: pay with them");
    }
    const kept = await this.#custody.keysOf(user.id);
    const keyring = kept === null ? undefined : this.#keyrings.get(kept.network);
    if (kept === null || keyring === undefined || kept.account !== user.account || kept.network !== user.network) {
      throw new AppError("FORBIDDEN", "KIJAM keeps no wallet for this account");
    }
    return { ...kept, keyring };
  }

  /**
   * @param {string} userId
   * @param {string} memo
   */
  async #openPayment(userId, memo) {
    for (const source of this.#payments) {
      const payment = await source.openPayment(userId, memo);
      if (payment !== null) {
        return payment;
      }
    }
    return null;
  }

  /**
   * A refused transfer can be paid again; one whose fate is unknown cannot, so it is not paid twice.
   * @param {unknown} error
   * @param {string} memo
   * @param {string} txId
   */
  async #relayFailure(error, memo, txId) {
    const code = error instanceof AppError ? error.code : "INTERNAL";
    if (UNCERTAIN.includes(code)) {
      return new AppError("CHAIN_UNAVAILABLE", "the network did not confirm the payment, but it may still go through", { txId });
    }
    await this.#repository.releaseTransfer(memo);
    return error;
  }

  /**
   * @param {import("./ports.js").Player} user
   * @param {string} action
   * @param {string} ip
   * @param {Record<string, unknown>} details
   */
  #record(user, action, ip, details) {
    return this.#audit.record({ actorKind: "user", actorUserId: user.id, action, targetKind: "account", targetId: `${user.network}:${user.account}`, ip, details });
  }
}
