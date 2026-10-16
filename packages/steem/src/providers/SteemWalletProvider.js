/**
 * WalletProvider for STEEM + Steem Keychain: proves that the person at the
 * keyboard controls an account, without any private key leaving the browser.
 *
 * The server issues a single-use challenge; the browser has Keychain sign
 * the exact login message with the account's posting key
 * (requestSignBuffer(account, message, "Posting")); the server recovers the
 * signing key from the signature and accepts it only if the account's
 * *current* posting authority on the chain lists it with enough weight.
 *
 * Players who sign in with their keys instead of Keychain sign in the
 * browser; the provider tells such a client which of the account's
 * authorities a key controls (so an active key typed where the posting key
 * belongs is refused before it is stored), and relays what it signs: a
 * transfer signed with the active key, or a ping (a comment on cur8.fun)
 * signed with the posting key. Only a single operation from the signed-in
 * account is relayed, re-encoded from what was checked. The signature
 * covers every byte, so relaying cannot alter it.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { isValidAccountName } from "../accountName.js";
import { STEEM_ASSETS, formatSteemAsset } from "../assets.js";
import { decodePublicKey, recoverSigner } from "../crypto/keys.js";
import { RpcError, RpcErrorCode } from "../rpc/SteemRpcClient.js";
import { fromBroadcastJson, serializeTransaction, toBroadcastJson, transactionId } from "../transactions/transaction.js";
import { STEEM_NETWORK } from "./SteemBlockchainProvider.js";

export const WalletError = Object.freeze({
  INVALID_ACCOUNT: "INVALID_ACCOUNT",
  MALFORMED_SIGNATURE: "MALFORMED_SIGNATURE",
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",
  KEY_NOT_AUTHORIZED: "KEY_NOT_AUTHORIZED",
  CHAIN_UNAVAILABLE: "CHAIN_UNAVAILABLE",
  MALFORMED_KEY: "MALFORMED_KEY",
  MALFORMED_TRANSACTION: "MALFORMED_TRANSACTION",
  NOT_A_TRANSFER: "NOT_A_TRANSFER",
  TRANSFER_REJECTED: "TRANSFER_REJECTED",
  NOT_A_PING: "NOT_A_PING",
  PING_REJECTED: "PING_REJECTED",
  UNSUPPORTED: "UNSUPPORTED",
});

/** The authorities of an account, strongest first. */
export const KEY_ROLES = Object.freeze(["owner", "active", "posting"]);

const SIGNATURE_PATTERN = /^[0-9a-f]{130}$/;
const MAX_SIGNATURES = 2;
const MAX_REJECTION_LENGTH = 200;

/** The key role Keychain is asked to sign with; also the only one accepted. */
export const LOGIN_KEY_ROLE = "Posting";

export class SteemWalletProvider {
  #chain;
  #appName;
  #rpc;

  /**
   * @param {{ chain: import("./SteemBlockchainProvider.js").SteemBlockchainProvider, appName: string, rpc?: { call: (method: string, params: unknown) => Promise<unknown> } }} deps
   *   `appName` is the first line of every login message, so users see what they sign;
   *   `rpc` broadcasts the transfers players sign in their browser (without it, none are relayed)
   */
  constructor({ chain, appName, rpc }) {
    if (typeof appName !== "string" || !/^[A-Za-z0-9 ._-]{1,40}$/.test(appName)) {
      throw new TypeError("SteemWalletProvider: appName must be a short plain name");
    }
    this.#chain = chain;
    this.#appName = appName;
    this.#rpc = rpc ?? null;
  }

  get network() {
    return STEEM_NETWORK;
  }

  get loginKeyRole() {
    return LOGIN_KEY_ROLE;
  }

  /** @param {unknown} name */
  isValidAccountName(name) {
    return isValidAccountName(name);
  }

  /**
   * The exact text the user signs. Every field is bound into the signature:
   * a signature for one account, nonce or site is useless for another.
   * @param {{ account: string, nonce: string, origin: string, issuedAt: number, expiresAt: number }} challenge
   */
  buildLoginMessage({ account, nonce, origin, issuedAt, expiresAt }) {
    return [
      `${this.#appName} login`,
      `account: ${account}`,
      `origin: ${origin}`,
      `nonce: ${nonce}`,
      `issued: ${new Date(issuedAt).toISOString()}`,
      `expires: ${new Date(expiresAt).toISOString()}`,
    ].join("\n");
  }

  /**
   * @param {{ account: string, message: string, signature: string }} proof
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<Readonly<{ network: string, account: string, publicKey: string }>> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async verifyLogin({ account, message, signature }) {
    if (!isValidAccountName(account)) {
      return fail(WalletError.INVALID_ACCOUNT, "invalid account name");
    }
    const publicKey = recoverSigner(message, signature);
    if (publicKey === null) {
      return fail(WalletError.MALFORMED_SIGNATURE, "the signature is malformed");
    }
    const authorized = await this.isPostingKey(account, publicKey);
    if (!authorized.ok) {
      return authorized;
    }
    return ok(Object.freeze({ network: STEEM_NETWORK, account, publicKey }));
  }

  /**
   * Whether `publicKey` alone satisfies the account's current posting authority.
   * Also used to revoke sessions whose login key has been removed from the account.
   * @param {string} account
   * @param {string} publicKey
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<true> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async isPostingKey(account, publicKey) {
    let chainAccount;
    try {
      chainAccount = await this.#chain.getAccount(account);
    } catch {
      return fail(WalletError.CHAIN_UNAVAILABLE, "the chain could not be read");
    }
    if (chainAccount === null) {
      return fail(WalletError.ACCOUNT_NOT_FOUND, "no such account");
    }
    const { posting } = chainAccount;
    const entry = posting.keys.find((candidate) => candidate.key === publicKey);
    if (entry === undefined || posting.threshold === 0 || entry.weight < posting.threshold) {
      return fail(WalletError.KEY_NOT_AUTHORIZED, "the signing key is not an authorised posting key of this account");
    }
    return ok(true);
  }

  /**
   * Which of the account's authorities `publicKey` satisfies on its own,
   * strongest first ([] for none): "posting" for a posting key, "active"
   * (and maybe "owner") for keys that can move funds.
   * @param {string} account
   * @param {string} publicKey "STM…"
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<readonly string[]> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async keyRolesOf(account, publicKey) {
    if (!isValidAccountName(account)) {
      return fail(WalletError.INVALID_ACCOUNT, "invalid account name");
    }
    if (decodePublicKey(publicKey) === null) {
      return fail(WalletError.MALFORMED_KEY, "not a STEEM public key");
    }
    let chainAccount;
    try {
      chainAccount = await this.#chain.getAccount(account);
    } catch {
      return fail(WalletError.CHAIN_UNAVAILABLE, "the chain could not be read");
    }
    if (chainAccount === null) {
      return fail(WalletError.ACCOUNT_NOT_FOUND, "no such account");
    }
    return ok(Object.freeze(KEY_ROLES.filter((role) => signsAlone(chainAccount[/** @type {"owner" | "active" | "posting"} */ (role)], publicKey))));
  }

  /**
   * The head block a transaction signed now must reference (TaPoS).
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<import("./SteemBlockchainProvider.js").BlockReference> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async reference() {
    try {
      return ok(await this.#chain.getReference());
    } catch {
      return fail(WalletError.CHAIN_UNAVAILABLE, "the chain could not be read");
    }
  }

  /**
   * Broadcasts a transfer `account` signed in its browser, given as the
   * node's JSON. A refusal by the chain (missing authority, not enough
   * funds) is a TRANSFER_REJECTED with the node's reason; CHAIN_UNAVAILABLE
   * does not prove the transfer was not relayed.
   * @param {string} account the signed-in player
   * @param {unknown} transaction
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail>} the transaction id
   */
  async broadcastTransfer(account, transaction) {
    return this.#relay(transaction, {
      accepts: (operation) => operation.type === "transfer" && operation.from === account,
      refused: [WalletError.NOT_A_TRANSFER, "only a single transfer from your own account is relayed"],
      rejected: WalletError.TRANSFER_REJECTED,
    });
  }

  /**
   * Broadcasts a ping `account` signed in its browser with its posting key:
   * a single comment by that account, which `accepts` (the caller's rule:
   * under the wall of the day). A refusal by the chain is a PING_REJECTED.
   * @param {string} account the signed-in player
   * @param {unknown} transaction
   * @param {(comment: import("../transactions/transaction.js").CommentOperation) => boolean} accepts
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail>} the transaction id
   */
  async broadcastComment(account, transaction, accepts) {
    return this.#relay(transaction, {
      accepts: (operation) => operation.type === "comment" && operation.author === account && accepts(operation),
      refused: [WalletError.NOT_A_PING, "only a single ping of your own under the wall is relayed"],
      rejected: WalletError.PING_REJECTED,
    });
  }

  /**
   * Relays a transaction signed in a player's browser: one operation the rule accepts, signed, re-encoded.
   * @param {unknown} transaction
   * @param {{ accepts: (operation: import("../transactions/transaction.js").Operation) => boolean, refused: readonly [string, string], rejected: string }} rule
   *   `refused`: the failure when the transaction is not the one operation accepted; `rejected`: the code of a refusal by the chain
   */
  async #relay(transaction, { accepts, refused, rejected }) {
    if (this.#rpc === null) {
      return fail(WalletError.UNSUPPORTED, "this server does not relay transactions");
    }
    let parsed;
    let serialized;
    try {
      parsed = fromBroadcastJson(transaction);
      serialized = serializeTransaction(parsed.transaction);
    } catch {
      return fail(WalletError.MALFORMED_TRANSACTION, "not a valid STEEM transaction");
    }
    const { operations } = parsed.transaction;
    if (operations.length !== 1 || !accepts(operations[0])) {
      return fail(refused[0], refused[1]);
    }
    const { signatures } = parsed;
    if (signatures.length === 0 || signatures.length > MAX_SIGNATURES || !signatures.every((signature) => typeof signature === "string" && SIGNATURE_PATTERN.test(signature))) {
      return fail(WalletError.MALFORMED_TRANSACTION, "the transaction is not signed");
    }
    try {
      await this.#rpc.call("condenser_api.broadcast_transaction", [toBroadcastJson(parsed.transaction, signatures)]);
    } catch (error) {
      if (error instanceof RpcError && error.code === RpcErrorCode.RPC_ERROR) {
        return fail(rejected, error.message.replace(/^[a-z_.]+: /, "").slice(0, MAX_REJECTION_LENGTH));
      }
      return fail(WalletError.CHAIN_UNAVAILABLE, "the chain could not be reached");
    }
    return ok(transactionId(serialized));
  }

  /**
   * What the account can spend right now (liquid balances), formatted as the
   * chain writes amounts: [{ asset: "STEEM", amount: "12.500" }, …].
   * @param {string} account
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<readonly Readonly<{ asset: string, amount: string }>[]> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async balancesOf(account) {
    let balances;
    try {
      balances = await this.#chain.getBalances(account);
    } catch {
      return fail(WalletError.CHAIN_UNAVAILABLE, "the chain could not be read");
    }
    if (balances === null) {
      return fail(WalletError.ACCOUNT_NOT_FOUND, "no such account");
    }
    return ok(Object.freeze(STEEM_ASSETS.map(({ asset }) => Object.freeze({ asset, amount: formatSteemAsset(balances[/** @type {"STEEM" | "SBD"} */ (asset)], asset).split(" ")[0] }))));
  }
}

/**
 * @param {import("./SteemBlockchainProvider.js").ChainAuthority} authority
 * @param {string} publicKey
 */
function signsAlone(authority, publicKey) {
  const entry = authority.keys.find((candidate) => candidate.key === publicKey);
  return entry !== undefined && authority.threshold > 0 && entry.weight >= authority.threshold;
}
