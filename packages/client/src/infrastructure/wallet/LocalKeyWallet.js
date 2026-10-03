/**
 * The player's own keys, typed into this browser (docs/tcg/20-chiavi.md):
 * a WalletConnector that signs with them, and the LocalKeys that keep them.
 *
 * - Posting key: checked against the account on the chain (it must be a
 *   posting key and nothing more), saved with the vault's device key, loaded
 *   at start-up. It signs messages: the login challenge, each online
 *   game's key.
 * - Active key: asked for (ActiveKeyPrompt) the first time a transfer needs
 *   it, checked against the account, optionally saved under a PIN, then held
 *   in memory until the page closes. A transfer is built here from the
 *   server's payment instructions, signed here, and relayed by the game
 *   server, which can neither read the key nor alter what was signed.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { blockReference, decodeWif, parseSteemAsset, publicKeyOf, serializeTransaction, signDigest, signMessage, toBroadcastJson, transactionDigest, transactionId } from "@magic8/steem";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { KeyFailure, MIN_PIN_LENGTH } from "../../application/ports/LocalKeys.contract.js";
import { WalletFailure } from "../../application/ports/WalletConnector.contract.js";

const POSTING = "posting";
const LOGIN_KEY_ROLE = "Posting";
const AMOUNT_PATTERN = /^\d{1,15}\.\d{3}$/;
const DEFAULT_EXPIRATION_SECONDS = 60;
/** Failures after which a transfer may or may not have reached the chain. */
const AMBIGUOUS = Object.freeze([ApiFailure.NETWORK, ApiFailure.UNAVAILABLE, "CHAIN_UNAVAILABLE"]);

/** @param {string} account */
const activeName = (account) => `active.${account}`;

/**
 * @typedef {{ account: string, key: Uint8Array, wif: string }} HeldKey
 */

export class LocalKeyWallet {
  #vault;
  #api;
  #prompt;
  #expirationSeconds;
  /** @type {HeldKey | null} */
  #posting = null;
  /** @type {HeldKey | null} */
  #active = null;

  /**
   * @param {{
   *   vault: import("./KeyVault.js").KeyVault,
   *   api: Pick<import("../api/HttpWalletApi.js").HttpWalletApi, "keyRoles" | "reference" | "broadcastTransfer">,
   *   prompt: Pick<import("../../application/wallet/ActiveKeyPrompt.js").ActiveKeyPrompt, "ask" | "close">,
   *   expirationSeconds?: number,
   * }} deps
   */
  constructor({ vault, api, prompt, expirationSeconds = DEFAULT_EXPIRATION_SECONDS }) {
    this.#vault = vault;
    this.#api = api;
    this.#prompt = prompt;
    this.#expirationSeconds = expirationSeconds;
  }

  get name() {
    return "your keys";
  }

  isAvailable() {
    return this.#posting !== null;
  }

  /** The account whose posting key is in memory. */
  get account() {
    return this.#posting?.account ?? null;
  }

  async restore() {
    const opened = await this.#vault.open(POSTING);
    const saved = opened.ok ? readSaved(opened.value) : null;
    if (saved === null) {
      if (!opened.ok || opened.value !== null) {
        // Unreadable (another device key, a damaged entry): it can never be used, so it goes.
        this.#vault.remove(POSTING);
      }
      return null;
    }
    this.#posting = saved;
    return saved.account;
  }

  /**
   * @param {string} account
   * @param {string} wif
   */
  async usePostingKey(account, wif) {
    const held = holdKey(account, wif);
    if (held === null) {
      return fail(KeyFailure.INVALID_KEY, describeInvalidKey(wif));
    }
    const roles = await this.#api.keyRoles(account, publicKeyOf(held.key));
    if (!roles.ok) {
      return roles;
    }
    if (roles.value.includes("active") || roles.value.includes("owner")) {
      return fail(KeyFailure.TOO_POWERFUL, "this key can move your funds (an active or owner key): sign in with your posting key");
    }
    if (!roles.value.includes("posting")) {
      return fail(KeyFailure.NOT_AUTHORIZED, `this is not a posting key of @${account}`);
    }
    if (this.#active !== null && this.#active.account !== account) {
      this.#active = null;
    }
    this.#posting = held;
    return ok(undefined);
  }

  async save() {
    if (this.#posting === null) {
      return fail(KeyFailure.STORAGE, "there is no key to save");
    }
    return this.#vault.seal(POSTING, JSON.stringify({ account: this.#posting.account, wif: this.#posting.wif }));
  }

  forget() {
    const account = this.#posting?.account ?? this.#active?.account ?? null;
    this.#posting = null;
    this.#active = null;
    this.#vault.remove(POSTING);
    if (account !== null) {
      this.#vault.remove(activeName(account));
    }
  }

  /**
   * Signs like Keychain's signBuffer, with the posting key.
   * @param {{ account: string, message: string, keyRole: string }} request
   */
  async signMessage({ account, message, keyRole }) {
    if (this.#posting === null || this.#posting.account !== account) {
      return fail(WalletFailure.NOT_INSTALLED, `no posting key of @${account} in this browser`);
    }
    if (keyRole !== LOGIN_KEY_ROLE) {
      return fail(WalletFailure.REJECTED, "only the posting key signs messages here");
    }
    return ok(signMessage(message, this.#posting.key));
  }

  /**
   * Pays exactly what the server's instructions say, signed with the active key.
   * @param {import("../../application/ports/WalletConnector.contract.js").TransferRequest} request
   */
  async requestTransfer({ from, to, amount, asset, memo }) {
    const parsed = AMOUNT_PATTERN.test(amount) ? parseSteemAsset(`${amount} ${asset}`) : null;
    if (parsed === null) {
      return fail(WalletFailure.BAD_RESPONSE, "the payment amount is not a 3-decimal amount of STEEM or SBD");
    }
    const key = await this.#activeKey(from);
    if (key === null) {
      return fail(WalletFailure.REJECTED, "the transfer was cancelled");
    }
    const reference = await this.#api.reference();
    if (!reference.ok) {
      return fail(WalletFailure.UNAVAILABLE, "the chain cannot be reached right now; nothing was sent");
    }
    let signed;
    try {
      const { blockNum, blockId, time } = reference.value;
      const transaction = { ...blockReference(blockNum, blockId), expiration: Math.floor(time / 1000) + this.#expirationSeconds, operations: [{ type: /** @type {const} */ ("transfer"), from, to, amount: parsed.amount, asset: parsed.asset, memo }] };
      const bytes = serializeTransaction(transaction);
      signed = { transaction: toBroadcastJson(transaction, [signDigest(transactionDigest(bytes), key)]), txId: transactionId(bytes) };
    } catch {
      return fail(WalletFailure.BAD_RESPONSE, "the transfer could not be signed");
    }
    const sent = await this.#api.broadcastTransfer(signed.transaction);
    if (!sent.ok) {
      return this.#transferFailure(sent.error);
    }
    return ok(signed.txId);
  }

  /**
   * The active key of `account`: in memory, or asked for until the player gives a right one or cancels.
   * @param {string} account
   * @returns {Promise<Uint8Array | null>}
   */
  async #activeKey(account) {
    if (this.#active?.account === account) {
      return this.#active.key;
    }
    const name = activeName(account);
    /** @type {{ code: string, message: string } | null} */
    let error = null;
    for (;;) {
      const answer = await this.#prompt.ask({ account, saved: this.#vault.has(name), error });
      if (answer === null) {
        return null;
      }
      if (answer.kind === "forget") {
        this.#vault.remove(name);
        error = null;
        continue;
      }
      const accepted = answer.kind === "pin" ? await this.#unlock(account, name, answer.pin) : await this.#acceptActive(account, name, answer.wif, answer.pin);
      if (accepted.ok) {
        this.#prompt.close();
        this.#active = accepted.value;
        return accepted.value.key;
      }
      error = accepted.error;
    }
  }

  /**
   * @param {string} account
   * @param {string} name
   * @param {string} pin
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<HeldKey> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async #unlock(account, name, pin) {
    const opened = await this.#vault.openWithPin(name, pin);
    if (!opened.ok) {
      return opened;
    }
    const held = opened.value === null ? null : holdKey(account, opened.value);
    if (held === null) {
      return fail(KeyFailure.STORAGE, "the saved key could not be read: type it again");
    }
    // Checked again: the account may have changed its keys since it was saved.
    const checked = await this.#checkActive(held);
    return checked.ok ? ok(held) : checked;
  }

  /**
   * @param {string} account
   * @param {string} name
   * @param {string} wif
   * @param {string | null} pin to save it with; null to keep it for this page only
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<HeldKey> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async #acceptActive(account, name, wif, pin) {
    const held = holdKey(account, wif);
    if (held === null) {
      return fail(KeyFailure.INVALID_KEY, describeInvalidKey(wif));
    }
    if (pin !== null && pin.length < MIN_PIN_LENGTH) {
      return fail(KeyFailure.WEAK_PIN, `the PIN needs at least ${MIN_PIN_LENGTH} characters`);
    }
    const checked = await this.#checkActive(held);
    if (!checked.ok) {
      return checked;
    }
    if (pin !== null) {
      const sealed = await this.#vault.sealWithPin(name, held.wif, pin);
      if (!sealed.ok) {
        return sealed;
      }
    }
    return ok(held);
  }

  /** @param {HeldKey} held */
  async #checkActive({ account, key }) {
    const roles = await this.#api.keyRoles(account, publicKeyOf(key));
    if (!roles.ok) {
      return roles;
    }
    if (roles.value.includes("active")) {
      return ok(undefined);
    }
    return fail(KeyFailure.NOT_AUTHORIZED, roles.value.includes("posting") ? "this is your posting key: sending STEEM needs the active key" : `this is not the active key of @${account}`);
  }

  /** @param {{ code: string, message: string }} error */
  #transferFailure(error) {
    if (AMBIGUOUS.includes(error.code)) {
      return fail(WalletFailure.TIMEOUT, "the network did not confirm the transfer, but it may still go through: check your wallet before paying again");
    }
    if (error.code === "TRANSFER_REJECTED" && /authority/i.test(error.message)) {
      // The account's active key changed: the one in memory is no use any more.
      this.#active = null;
    }
    return fail(WalletFailure.REJECTED, error.code === "TRANSFER_REJECTED" ? `the chain refused the transfer: ${error.message}` : error.message);
  }
}

/**
 * @param {string} account
 * @param {string} wif
 * @returns {HeldKey | null}
 */
function holdKey(account, wif) {
  const trimmed = String(wif).trim();
  const key = decodeWif(trimmed);
  return key === null ? null : { account, key, wif: trimmed };
}

/**
 * @param {string | null} text what the vault held
 * @returns {HeldKey | null}
 */
function readSaved(text) {
  if (text === null) {
    return null;
  }
  try {
    const saved = JSON.parse(text);
    return typeof saved?.account === "string" && typeof saved.wif === "string" ? holdKey(saved.account, saved.wif) : null;
  } catch {
    return null;
  }
}

/**
 * Why typed text is not a private key, in the player's terms.
 * @param {string} text
 */
function describeInvalidKey(text) {
  const trimmed = String(text).trim();
  if (trimmed.startsWith("STM")) {
    return "that is a public key: paste the private key, which starts with 5";
  }
  if (trimmed.startsWith("P5")) {
    return "that is your master password: paste the key itself, never the password";
  }
  return "that is not a private key (51 characters, starting with 5)";
}
