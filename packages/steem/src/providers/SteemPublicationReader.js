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

export class SteemPublicationReader {
  #chain;

  /**
   * @param {{ chain: Pick<import("./SteemBlockchainProvider.js").SteemBlockchainProvider, "getHead" | "getAccountHistory" | "getLatestHistoryIndex" | "getBlock"> & Partial<Pick<import("./SteemBlockchainProvider.js").SteemBlockchainProvider, "getAccount">> }} deps
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
