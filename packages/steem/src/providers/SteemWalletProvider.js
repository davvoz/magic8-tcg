/**
 * WalletProvider for STEEM + Steem Keychain: proves that the person at the
 * keyboard controls an account, without any private key leaving the browser.
 *
 * The server issues a single-use challenge; the browser has Keychain sign
 * the exact login message with the account's posting key
 * (requestSignBuffer(account, message, "Posting")); the server recovers the
 * signing key from the signature and accepts it only if the account's
 * *current* posting authority on the chain lists it with enough weight.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { isValidAccountName } from "../accountName.js";
import { STEEM_ASSETS, formatSteemAsset } from "../assets.js";
import { recoverSigner } from "../crypto/keys.js";
import { STEEM_NETWORK } from "./SteemBlockchainProvider.js";

export const WalletError = Object.freeze({
  INVALID_ACCOUNT: "INVALID_ACCOUNT",
  MALFORMED_SIGNATURE: "MALFORMED_SIGNATURE",
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",
  KEY_NOT_AUTHORIZED: "KEY_NOT_AUTHORIZED",
  CHAIN_UNAVAILABLE: "CHAIN_UNAVAILABLE",
});

/** The key role Keychain is asked to sign with; also the only one accepted. */
export const LOGIN_KEY_ROLE = "Posting";

export class SteemWalletProvider {
  #chain;
  #appName;

  /**
   * @param {{ chain: import("./SteemBlockchainProvider.js").SteemBlockchainProvider, appName: string }} deps
   *   `appName` is the first line of every login message, so users see what they sign
   */
  constructor({ chain, appName }) {
    if (typeof appName !== "string" || !/^[A-Za-z0-9 ._-]{1,40}$/.test(appName)) {
      throw new TypeError("SteemWalletProvider: appName must be a short plain name");
    }
    this.#chain = chain;
    this.#appName = appName;
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
