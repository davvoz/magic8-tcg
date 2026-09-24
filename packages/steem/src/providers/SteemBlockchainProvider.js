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
 * @typedef {Readonly<{ type: string, data: Readonly<Record<string, unknown>> }>} ChainOperation
 * @typedef {Readonly<{ index: number, txId: string, blockNum: number, opIndex: number, virtual: boolean, time: number, operation: ChainOperation }>} HistoryEntry
 * @typedef {Readonly<{ blockNum: number, time: number, transactions: readonly Readonly<{ txId: string, operations: readonly ChainOperation[] }>[] }>} ChainBlock
 */

const TX_ID_PATTERN = /^[0-9a-f]{40}$/;
const MAX_HISTORY_PAGE = 1000;

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

/**
 * @param {unknown} raw ["transfer", { … }]
 * @param {string} what
 * @returns {ChainOperation}
 */
function parseOperation(raw, what) {
  if (!Array.isArray(raw) || raw.length !== 2 || typeof raw[0] !== "string") {
    throw new ChainDataError(`${what}: expected [type, data]`);
  }
  return Object.freeze({ type: raw[0], data: Object.freeze({ ...requireObject(raw[1], `${what} data`) }) });
}

/**
 * @param {unknown} pair [index, { trx_id, block, op_in_trx, virtual_op, timestamp, op }]
 * @param {string} what
 * @returns {HistoryEntry}
 */
function parseHistoryEntry(pair, what) {
  if (!Array.isArray(pair) || pair.length !== 2) {
    throw new ChainDataError(`${what}: expected [index, entry]`);
  }
  const entry = requireObject(pair[1], what);
  if (typeof entry.trx_id !== "string" || !TX_ID_PATTERN.test(entry.trx_id)) {
    throw new ChainDataError(`${what}.trx_id: expected a transaction id`);
  }
  return Object.freeze({
    index: requireNonNegativeInteger(pair[0], `${what} index`),
    txId: entry.trx_id,
    blockNum: requireNonNegativeInteger(entry.block, `${what}.block`),
    opIndex: requireNonNegativeInteger(entry.op_in_trx, `${what}.op_in_trx`),
    virtual: entry.virtual_op !== 0 && entry.virtual_op !== false,
    time: parseChainTime(entry.timestamp),
    operation: parseOperation(entry.op, `${what}.op`),
  });
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
   * Entries of an account's history with index in (after, after + limit],
   * oldest first. The history index of an account only grows, so a reader
   * that remembers the last index it processed never misses or repeats one.
   * @param {string} account
   * @param {number} after last index already read (-1 for none)
   * @param {number} limit 1..1000
   * @returns {Promise<readonly HistoryEntry[]>}
   */
  async getAccountHistory(account, after, limit) {
    if (!isValidAccountName(account) || !Number.isSafeInteger(after) || after < -1 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_HISTORY_PAGE) {
      throw new RangeError("getAccountHistory: invalid account, cursor or limit");
    }
    // The node returns the entries with index in [start - limit, start], clamped to the newest; start must be ≥ limit.
    const start = Math.max(after + limit, limit);
    const raw = await this.#rpc.call("condenser_api.get_account_history", [account, start, limit]);
    if (!Array.isArray(raw) || raw.length > limit + 1) {
      throw new ChainDataError("get_account_history: expected a bounded array");
    }
    const entries = raw.map((pair, position) => parseHistoryEntry(pair, `history[${position}]`));
    entries.forEach((entry, position) => {
      if (position > 0 && entry.index <= entries[position - 1].index) {
        throw new ChainDataError("get_account_history: indexes must increase");
      }
    });
    return Object.freeze(entries.filter((entry) => entry.index > after && entry.index <= after + limit));
  }

  /**
   * The index of an account's newest history entry, -1 when it has none.
   * @param {string} account
   */
  async getLatestHistoryIndex(account) {
    if (!isValidAccountName(account)) {
      throw new RangeError("getLatestHistoryIndex: invalid account");
    }
    const raw = await this.#rpc.call("condenser_api.get_account_history", [account, -1, 1]);
    if (!Array.isArray(raw) || raw.length > 2) {
      throw new ChainDataError("get_account_history: expected a bounded array");
    }
    return raw.length === 0 ? -1 : parseHistoryEntry(raw[raw.length - 1], "history").index;
  }

  /**
   * @param {number} blockNum
   * @returns {Promise<ChainBlock | null>} null when the node does not have the block (yet)
   */
  async getBlock(blockNum) {
    if (!Number.isSafeInteger(blockNum) || blockNum < 1) {
      throw new RangeError("getBlock: invalid block number");
    }
    const raw = await this.#rpc.call("condenser_api.get_block", [blockNum]);
    if (raw === null) {
      return null;
    }
    const block = requireObject(raw, "block");
    const ids = block.transaction_ids;
    const transactions = block.transactions;
    if (!Array.isArray(ids) || !Array.isArray(transactions) || ids.length !== transactions.length) {
      throw new ChainDataError("block: transaction ids and transactions must match");
    }
    return Object.freeze({
      blockNum,
      time: parseChainTime(block.timestamp),
      transactions: Object.freeze(
        transactions.map((transaction, position) => {
          const txId = ids[position];
          if (typeof txId !== "string" || !TX_ID_PATTERN.test(txId)) {
            throw new ChainDataError(`block: transaction_ids[${position}] is not a transaction id`);
          }
          const operations = requireObject(transaction, `block.transactions[${position}]`).operations;
          if (!Array.isArray(operations)) {
            throw new ChainDataError(`block.transactions[${position}].operations: expected an array`);
          }
          return Object.freeze({ txId, operations: Object.freeze(operations.map((operation, index) => parseOperation(operation, `block.transactions[${position}].operations[${index}]`))) });
        }),
      ),
    });
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
