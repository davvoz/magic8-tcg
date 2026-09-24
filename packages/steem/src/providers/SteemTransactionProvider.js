/**
 * TransactionProvider for STEEM: signs and broadcasts the game's own
 * `custom_json` operations with the posting keys of the broadcaster
 * accounts, and reports their Resource Credits.
 *
 * Keys stay inside this object: callers name a signer account, never a key.
 * `verifySigners` refuses a key that is not a posting key of its account, and
 * refuses outright a key that also controls the active or owner authority:
 * if the server were compromised, the attacker could publish game records in
 * the broadcaster's name, but never move funds or take over the account.
 */
import { isValidAccountName } from "../accountName.js";
import { decodeWif, publicKeyOf } from "../crypto/keys.js";
import { MAX_EXPIRATION_SECONDS, STEEM_CHAIN_ID, blockReference, serializeTransaction, signDigest, toBroadcastJson, transactionDigest, transactionId } from "../transactions/transaction.js";
import { ChainDataError, STEEM_NETWORK } from "./SteemBlockchainProvider.js";

export class SignerError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "SignerError";
  }
}

/** RC regenerate fully in 5 days (STEEM_RC_REGEN_TIME). */
const RC_REGEN_SECONDS = 5n * 24n * 3600n;
const BASIS_POINTS = 10_000n;

/**
 * @typedef {Readonly<{ txId: string, expiration: number, transaction: Readonly<Record<string, unknown>> }>} SignedTransaction
 *   expiration in Unix ms; `transaction` is what broadcast() takes
 * @typedef {Readonly<{ account: string, basisPoints: number }>} ResourceLevel 0..10000 of the account's maximum
 */

/**
 * @param {unknown} value
 */
function toBigInt(value) {
  if ((typeof value !== "string" || !/^\d{1,40}$/.test(value)) && !Number.isSafeInteger(value)) {
    throw new ChainDataError("rc: expected an unsigned integer");
  }
  return BigInt(/** @type {string | number} */ (value));
}

export class SteemTransactionProvider {
  #rpc;
  #chain;
  /** @type {Map<string, Uint8Array>} account → private posting key */
  #keys = new Map();
  #chainId;
  #expirationSeconds;

  /**
   * @param {{
   *   rpc: { call: (method: string, params: unknown) => Promise<unknown> },
   *   chain: import("./SteemBlockchainProvider.js").SteemBlockchainProvider,
   *   keys: ReadonlyMap<string, string>,
   *   chainId?: Uint8Array,
   *   expirationSeconds?: number,
   * }} deps `keys`: account → WIF of its posting key
   */
  constructor({ rpc, chain, keys, chainId = STEEM_CHAIN_ID, expirationSeconds = 60 }) {
    for (const [account, wif] of keys) {
      const key = decodeWif(wif);
      if (!isValidAccountName(account) || key === null) {
        throw new SignerError(`broadcaster "${account}": invalid account name or WIF`);
      }
      this.#keys.set(account, key);
    }
    if (!Number.isInteger(expirationSeconds) || expirationSeconds < 10 || expirationSeconds > MAX_EXPIRATION_SECONDS) {
      throw new RangeError(`expirationSeconds: 10..${MAX_EXPIRATION_SECONDS}`);
    }
    this.#rpc = rpc;
    this.#chain = chain;
    this.#chainId = chainId;
    this.#expirationSeconds = expirationSeconds;
  }

  get network() {
    return STEEM_NETWORK;
  }

  /** @returns {readonly string[]} */
  get signers() {
    return Object.freeze([...this.#keys.keys()]);
  }

  /**
   * Checks every configured key against its account on chain.
   * @throws {SignerError}
   */
  async verifySigners() {
    for (const [account, key] of this.#keys) {
      const onChain = await this.#chain.getAccount(account);
      if (onChain === null) {
        throw new SignerError(`broadcaster "${account}" does not exist on ${STEEM_NETWORK}`);
      }
      const publicKey = publicKeyOf(key);
      const holds = (authority) => authority.keys.some((entry) => entry.key === publicKey);
      if (holds(onChain.active) || holds(onChain.owner)) {
        throw new SignerError(`broadcaster "${account}": the configured key controls the active or owner authority; give the server the posting key only`);
      }
      const posting = onChain.posting.keys.find((entry) => entry.key === publicKey);
      if (posting === undefined || posting.weight < onChain.posting.threshold) {
        throw new SignerError(`broadcaster "${account}": the configured key is not a posting key that can sign alone`);
      }
    }
  }

  /** The head block to reference; fetch once per round of signing. */
  reference() {
    return this.#chain.getReference();
  }

  /**
   * @param {{ reference: import("./SteemBlockchainProvider.js").BlockReference, signer: string, id: string, json: string }} request
   * @returns {SignedTransaction}
   */
  signCustomJson({ reference, signer, id, json }) {
    const key = this.#keys.get(signer);
    if (key === undefined) {
      throw new SignerError(`no key for broadcaster "${signer}"`);
    }
    const expiration = Math.floor(reference.time / 1000) + this.#expirationSeconds;
    const transaction = { ...blockReference(reference.blockNum, reference.blockId), expiration, operations: [{ type: /** @type {const} */ ("custom_json"), requiredAuths: [], requiredPostingAuths: [signer], id, json }] };
    const serialized = serializeTransaction(transaction);
    const signature = signDigest(transactionDigest(serialized, this.#chainId), key);
    return Object.freeze({ txId: transactionId(serialized), expiration: expiration * 1000, transaction: Object.freeze(toBroadcastJson(transaction, [signature])) });
  }

  /**
   * Sends a signed transaction. An error does not prove the chain refused
   * it (a node may time out after relaying it): callers wait for its
   * expiration before signing the same content again.
   * @param {Readonly<Record<string, unknown>>} transaction
   */
  async broadcast(transaction) {
    await this.#rpc.call("condenser_api.broadcast_transaction", [transaction]);
  }

  /**
   * @param {string} account
   * @param {number} at chain time (Unix ms) to regenerate mana up to
   * @returns {Promise<ResourceLevel>}
   */
  async resourceLevel(account, at) {
    const reply = /** @type {any} */ (await this.#rpc.call("rc_api.find_rc_accounts", { accounts: [account] }));
    const entry = Array.isArray(reply?.rc_accounts) ? reply.rc_accounts.find((candidate) => candidate?.account === account) : undefined;
    if (entry === undefined || entry.rc_manabar === null || typeof entry.rc_manabar !== "object") {
      throw new ChainDataError(`rc_api.find_rc_accounts: no entry for ${account}`);
    }
    const max = toBigInt(entry.max_rc);
    if (max === 0n) {
      return Object.freeze({ account, basisPoints: 0 });
    }
    const elapsed = BigInt(Math.max(0, Math.floor(at / 1000) - Number(toBigInt(entry.rc_manabar.last_update_time))));
    const regenerated = toBigInt(entry.rc_manabar.current_mana) + (max * elapsed) / RC_REGEN_SECONDS;
    const current = regenerated > max ? max : regenerated;
    return Object.freeze({ account, basisPoints: Number((current * BASIS_POINTS) / max) });
  }
}
