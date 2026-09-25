/**
 * Reads `custom_json` publications from STEEM as network-neutral protocol
 * operations (`ChainOperation` of @magic8/protocol): from an account's
 * history (the tracker follows the broadcasters with a cursor) and from
 * blocks (irreversibility checks, verifiers given block numbers).
 *
 * Any operation that is not a well-formed `custom_json` maps to null: the
 * caller still advances past it, but never reads anything from it.
 */
import { STEEM_NETWORK } from "./SteemBlockchainProvider.js";

const MAX_ID_LENGTH = 32;

/**
 * @param {unknown} list
 * @returns {readonly string[] | null}
 */
function accountList(list) {
  return Array.isArray(list) && list.every((item) => typeof item === "string") ? Object.freeze([...list]) : null;
}

/**
 * @param {{ txId: string, blockNum: number, opIndex: number, operation: import("./SteemBlockchainProvider.js").ChainOperation }} source
 * @returns {import("@magic8/protocol").ChainOperation | null}
 */
export function customJsonOperation({ txId, blockNum, opIndex, operation }) {
  if (operation.type !== "custom_json") {
    return null;
  }
  const { id, json } = operation.data;
  const requiredAuths = accountList(operation.data.required_auths);
  const requiredPostingAuths = accountList(operation.data.required_posting_auths);
  if (typeof id !== "string" || id.length > MAX_ID_LENGTH || typeof json !== "string" || requiredAuths === null || requiredPostingAuths === null) {
    return null;
  }
  return Object.freeze({ network: STEEM_NETWORK, txId, blockNum, opIndex, id, requiredAuths, requiredPostingAuths, json });
}

/**
 * The keys that alone satisfy an authority as an operation carries it, or null when the operation leaves it unchanged.
 * @param {unknown} authority { weight_threshold, key_auths: [[key, weight]…] }
 * @returns {readonly string[] | null}
 */
function soleKeys(authority) {
  if (authority === null || typeof authority !== "object") {
    return null;
  }
  const { weight_threshold: threshold, key_auths: keyAuths } = /** @type {any} */ (authority);
  if (!Number.isSafeInteger(threshold) || !Array.isArray(keyAuths)) {
    return null;
  }
  return Object.freeze(keyAuths.filter((pair) => Array.isArray(pair) && typeof pair[0] === "string" && threshold > 0 && pair[1] >= threshold).map((pair) => pair[0]));
}

export class SteemPublicationReader {
  #chain;

  /**
   * @param {{ chain: Pick<import("./SteemBlockchainProvider.js").SteemBlockchainProvider, "getHead" | "getAccountHistory" | "getLatestHistoryIndex" | "getBlock"> & Partial<Pick<import("./SteemBlockchainProvider.js").SteemBlockchainProvider, "getAccount" | "getAuthorityHistory">> }} deps
   */
  constructor({ chain }) {
    this.#chain = chain;
  }

  get network() {
    return STEEM_NETWORK;
  }

  head() {
    return this.#chain.getHead();
  }

  /** @param {string} account */
  latestIndex(account) {
    return this.#chain.getLatestHistoryIndex(account);
  }

  /**
   * The keys that alone satisfy the account's posting authority today (session keys are authorised with one), or null for no such account.
   * @param {string} account
   * @returns {Promise<readonly string[] | null>}
   */
  async postingKeys(account) {
    if (this.#chain.getAccount === undefined) {
      return null;
    }
    const found = await this.#chain.getAccount(account);
    if (found === null) {
      return null;
    }
    const { posting } = found;
    return Object.freeze(posting.keys.filter((entry) => posting.threshold > 0 && entry.weight >= posting.threshold).map((entry) => entry.key));
  }

  /**
   * When the account's posting keys changed: at each creation or update that
   * set the posting authority, the keys that alone satisfied it from that
   * block on. Null when the node cannot tell (no filter support, unreachable).
   * @param {string} account
   * @returns {Promise<Readonly<{ complete: boolean, changes: readonly Readonly<{ blockNum: number, keys: readonly string[], created: boolean }>[] }> | null>}
   *   `created`: the change is the account's creation, so the history starts there
   */
  async postingKeyHistory(account) {
    if (this.#chain.getAuthorityHistory === undefined) {
      return null;
    }
    let history;
    try {
      history = await this.#chain.getAuthorityHistory(account);
    } catch {
      return null;
    }
    const changes = history.entries.flatMap((entry) => {
      const { data } = entry.operation;
      const subject = data.new_account_name ?? data.account;
      const keys = subject === account ? soleKeys(data.posting) : null;
      return keys === null ? [] : [Object.freeze({ blockNum: entry.blockNum, keys, created: entry.operation.type !== "account_update" })];
    });
    return Object.freeze({ complete: history.complete, changes: Object.freeze(changes) });
  }

  /**
   * @param {string} account
   * @param {number} after last history index already read
   * @param {number} limit
   * @returns {Promise<readonly Readonly<{ index: number, operation: import("@magic8/protocol").ChainOperation | null }>[]>}
   */
  async publications(account, after, limit) {
    const entries = await this.#chain.getAccountHistory(account, after, limit);
    return Object.freeze(entries.map((entry) => Object.freeze({ index: entry.index, operation: entry.virtual ? null : customJsonOperation(entry) })));
  }

  /**
   * The custom_json operations of a block, or null when the node does not have it.
   * @param {number} blockNum
   * @returns {Promise<readonly import("@magic8/protocol").ChainOperation[] | null>}
   */
  async blockOperations(blockNum) {
    const block = await this.#chain.getBlock(blockNum);
    if (block === null) {
      return null;
    }
    const operations = [];
    for (const { txId, operations: list } of block.transactions) {
      list.forEach((operation, opIndex) => {
        const mapped = customJsonOperation({ txId, blockNum, opIndex, operation });
        if (mapped !== null) {
          operations.push(mapped);
        }
      });
    }
    return Object.freeze(operations);
  }
}
