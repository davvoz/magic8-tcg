/**
 * BlockchainProvider for STEEM: network-neutral reads.
 *
 * Every node response is validated and mapped to plain DTOs before it
 * leaves this module; nothing STEEM-shaped reaches the application layer.
 */
import { isValidAccountName } from "../accountName.js";
import { decodePublicKey } from "../crypto/keys.js";

export const STEEM_NETWORK = "steem";

/**
 * @typedef {Readonly<{ threshold: number, keys: readonly Readonly<{ key: string, weight: number }>[], accounts: readonly Readonly<{ account: string, weight: number }>[] }>} ChainAuthority
 * @typedef {Readonly<{ network: string, name: string, posting: ChainAuthority, active: ChainAuthority }>} ChainAccount
 * @typedef {Readonly<{ headBlock: number, irreversibleBlock: number, time: number }>} ChainHead
 */

export class ChainDataError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "ChainDataError";
  }
}

const MAX_AUTHORITY_ENTRIES = 40;

/**
 * @param {unknown} value
 * @param {string} what
 */
function requireObject(value, what) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ChainDataError(`${what}: expected an object`);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {unknown} value
 * @param {string} what
 */
function requireNonNegativeInteger(value, what) {
  if (!Number.isSafeInteger(value) || /** @type {number} */ (value) < 0) {
    throw new ChainDataError(`${what}: expected a non-negative integer`);
  }
  return /** @type {number} */ (value);
}

/**
 * @param {unknown} raw
 * @param {string} what
 * @returns {ChainAuthority}
 */
function parseAuthority(raw, what) {
  const authority = requireObject(raw, what);
  const pairs = (list, name) => {
    if (!Array.isArray(list) || list.length > MAX_AUTHORITY_ENTRIES) {
      throw new ChainDataError(`${what}.${name}: expected a bounded array`);
    }
    return list.map((pair, index) => {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string") {
        throw new ChainDataError(`${what}.${name}[${index}]: expected [string, weight]`);
      }
      return [pair[0], requireNonNegativeInteger(pair[1], `${what}.${name}[${index}] weight`)];
    });
  };
  const keys = pairs(authority.key_auths, "key_auths").filter(([key]) => decodePublicKey(key) !== null);
  const accounts = pairs(authority.account_auths, "account_auths").filter(([account]) => isValidAccountName(account));
  return Object.freeze({
    threshold: requireNonNegativeInteger(authority.weight_threshold, `${what}.weight_threshold`),
    keys: Object.freeze(keys.map(([key, weight]) => Object.freeze({ key, weight }))),
    accounts: Object.freeze(accounts.map(([account, weight]) => Object.freeze({ account, weight }))),
  });
}

/**
 * STEEM returns times as "YYYY-MM-DDTHH:MM:SS" in UTC, without a zone designator.
 * @param {unknown} value
 */
function parseChainTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
    throw new ChainDataError("time: expected YYYY-MM-DDTHH:MM:SS");
  }
  const time = Date.parse(`${value}Z`);
  if (Number.isNaN(time)) {
    throw new ChainDataError("time: not a valid date");
  }
  return time;
}

export class SteemBlockchainProvider {
  #rpc;

  /** @param {{ rpc: { call: (method: string, params: unknown) => Promise<unknown> } }} deps */
  constructor({ rpc }) {
    this.#rpc = rpc;
  }

  get network() {
    return STEEM_NETWORK;
  }

  /** @returns {Promise<ChainHead>} */
  async getHead() {
    const properties = requireObject(await this.#rpc.call("condenser_api.get_dynamic_global_properties", []), "dynamic global properties");
    const headBlock = requireNonNegativeInteger(properties.head_block_number, "head_block_number");
    const irreversibleBlock = requireNonNegativeInteger(properties.last_irreversible_block_num, "last_irreversible_block_num");
    if (irreversibleBlock > headBlock) {
      throw new ChainDataError("irreversible block is ahead of the head block");
    }
    return Object.freeze({ headBlock, irreversibleBlock, time: parseChainTime(properties.time) });
  }

  /**
   * @param {string} name
   * @returns {Promise<ChainAccount | null>}
   */
  async getAccount(name) {
    if (!isValidAccountName(name)) {
      return null;
    }
    const accounts = await this.#rpc.call("condenser_api.get_accounts", [[name]]);
    if (!Array.isArray(accounts) || accounts.length > 1) {
      throw new ChainDataError("get_accounts: expected at most one account");
    }
    if (accounts.length === 0) {
      return null;
    }
    const account = requireObject(accounts[0], "account");
    if (account.name !== name) {
      throw new ChainDataError("get_accounts: returned a different account");
    }
    return Object.freeze({
      network: STEEM_NETWORK,
      name,
      posting: parseAuthority(account.posting, "posting"),
      active: parseAuthority(account.active, "active"),
    });
  }
}
