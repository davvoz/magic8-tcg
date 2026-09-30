/**
 * PaymentProvider for STEEM transfers (docs/tcg/01-architettura.md §6).
 *
 * - Detection: the shop account's history, read forward from a cursor
 *   (the history index), through the failover RPC client. Every `transfer`
 *   *to* the shop becomes a neutral Transfer DTO, whatever its asset or memo:
 *   a transfer that pays nothing still has to be seen, to be refunded.
 *   Transfers *from* the shop (refunds an operator sent with Keychain) are
 *   read the same way, from their own cursor.
 *   History indexes are not the same on every node: api.steemit.com lists
 *   some operations twice where api.moecki.online lists them once, so after
 *   a failover the same index can name a later entry on one node than on the
 *   other (2026-09-30: a paid order was never seen). Each read therefore
 *   starts HISTORY_OVERLAP entries before the cursor and keeps, besides the
 *   entries past the cursor, those of the overlap in blocks at or after
 *   `sinceBlock` (the block of the last entry read): block numbers mean the
 *   same thing on every node. The same transfer can so come back; whoever
 *   records it must be idempotent (payments are keyed by transaction and
 *   operation). The cursor never moves back.
 * - Confirmation: a transfer is final only when at least `quorum` distinct
 *   nodes, each asked directly, place it in a block at or below their last
 *   irreversible block, with exactly the same sender, receiver, amount and
 *   memo (T8: micro-forks; T21: a lying or stale node). One node saying
 *   otherwise is enough to wait.
 *
 * @typedef {Readonly<{ network: string, txId: string, opIndex: number, blockNum: number, time: number, from: string, to: string, asset: string, amount: number, memo: string }>} Transfer
 * @typedef {"IRREVERSIBLE" | "PENDING" | "MISSING"} Confirmation
 * @typedef {Pick<import("./SteemBlockchainProvider.js").SteemBlockchainProvider, "getHead" | "getBlock" | "getAccountHistory" | "getLatestHistoryIndex" | "getLatestHistoryEntry">} ChainReader
 * @typedef {Readonly<{ transfers: readonly Transfer[], cursor: number, sinceBlock: number | null }>} TransferPage
 */
import { isValidAccountName } from "../accountName.js";
import { STEEM_ASSETS, parseSteemAsset } from "../assets.js";
import { STEEM_NETWORK } from "./SteemBlockchainProvider.js";

export const Confirmation = Object.freeze({ IRREVERSIBLE: "IRREVERSIBLE", PENDING: "PENDING", MISSING: "MISSING" });

const MAX_MEMO_LENGTH = 2048;
const DEFAULT_QUORUM = 2;
/** Entries re-read before the cursor, to cover nodes that number the history differently. */
export const HISTORY_OVERLAP = 20;

export class SteemTransferPaymentProvider {
  #history;
  #verifiers;
  #quorum;

  /**
   * @param {{ history: ChainReader, verifiers: readonly ChainReader[], quorum?: number }} deps
   *   `verifiers`: one reader per node, each bound to a single node (no failover inside)
   */
  constructor({ history, verifiers, quorum = DEFAULT_QUORUM }) {
    if (!Number.isInteger(quorum) || quorum < 2) {
      throw new RangeError("SteemTransferPaymentProvider: payments need the agreement of at least 2 nodes");
    }
    if (verifiers.length < quorum) {
      throw new RangeError(`SteemTransferPaymentProvider: ${quorum} verifier nodes are needed, ${verifiers.length} configured`);
    }
    this.#history = history;
    this.#verifiers = verifiers;
    this.#quorum = quorum;
  }

  get network() {
    return STEEM_NETWORK;
  }

  supportedAssets() {
    return STEEM_ASSETS;
  }

  /**
   * Where a new watcher starts: after the account's newest history entry.
   * Only the index; a reader that cannot tell a skewed overlap entry from a
   * new one (no `sinceBlock`) must only care about transfers it can
   * recognise, as a sale does by its memo.
   * @param {string} account
   */
  latestCursor(account) {
    return this.#history.getLatestHistoryIndex(account);
  }

  /**
   * Where a new watcher starts, with the block its first read may begin at:
   * nothing in the history so far, whatever a node numbers it, is read.
   * @param {string} account
   * @returns {Promise<Readonly<{ cursor: number, sinceBlock: number }>>}
   */
  async latestPosition(account) {
    const latest = await this.#history.getLatestHistoryEntry(account);
    return Object.freeze(latest === null ? { cursor: -1, sinceBlock: 0 } : { cursor: latest.index, sinceBlock: latest.blockNum + 1 });
  }

  /**
   * Incoming transfers after `cursor`, oldest first, and where to read next.
   * @param {string} receiver
   * @param {number} cursor
   * @param {number} limit entries per read, overlap included; more than HISTORY_OVERLAP
   * @param {number | null} [sinceBlock] from the previous page (or latestPosition); null keeps the whole overlap
   * @returns {Promise<TransferPage>}
   */
  incomingTransfers(receiver, cursor, limit, sinceBlock = null) {
    return this.#transfers(receiver, { cursor, limit, sinceBlock }, (data) => data.to === receiver);
  }

  /**
   * Transfers sent by `sender` after `cursor`, oldest first, and where to read next.
   * @param {string} sender
   * @param {number} cursor
   * @param {number} limit
   * @param {number | null} [sinceBlock]
   * @returns {Promise<TransferPage>}
   */
  outgoingTransfers(sender, cursor, limit, sinceBlock = null) {
    return this.#transfers(sender, { cursor, limit, sinceBlock }, (data) => data.from === sender);
  }

  /**
   * @param {string} account
   * @param {{ cursor: number, limit: number, sinceBlock: number | null }} page
   * @param {(data: Readonly<Record<string, unknown>>) => boolean} direction
   * @returns {Promise<TransferPage>}
   */
  async #transfers(account, { cursor, limit, sinceBlock }, direction) {
    if (limit <= HISTORY_OVERLAP) {
      throw new RangeError(`SteemTransferPaymentProvider: a history page must be longer than the ${HISTORY_OVERLAP}-entry overlap`);
    }
    const read = await this.#history.getAccountHistory(account, Math.max(-1, cursor - HISTORY_OVERLAP), limit);
    const entries = read.filter((entry) => entry.index > cursor || sinceBlock === null || entry.blockNum >= sinceBlock);
    const transfers = entries
      .filter((entry) => !entry.virtual && entry.operation.type === "transfer" && direction(entry.operation.data))
      .map((entry) => toTransfer(entry.operation.data, { txId: entry.txId, opIndex: entry.opIndex, blockNum: entry.blockNum, time: entry.time }))
      .filter((transfer) => transfer !== null);
    const last = read.at(-1);
    return Object.freeze({
      transfers: Object.freeze(/** @type {Transfer[]} */ (transfers)),
      cursor: last === undefined ? cursor : Math.max(cursor, last.index),
      sinceBlock: last === undefined ? sinceBlock : Math.max(sinceBlock ?? 0, last.blockNum),
    });
  }

  /**
   * @param {Transfer} transfer as recorded when detected
   * @returns {Promise<Confirmation>}
   */
  async confirm(transfer) {
    let irreversible = 0;
    let missing = 0;
    for (const verifier of this.#verifiers) {
      const verdict = await this.#askNode(verifier, transfer);
      if (verdict === Confirmation.IRREVERSIBLE) {
        irreversible += 1;
      } else if (verdict === Confirmation.MISSING) {
        missing += 1;
      }
      if (verdict === Confirmation.PENDING && irreversible + missing === 0) {
        // The first node that answers says "not yet": no need to ask the rest now.
        return Confirmation.PENDING;
      }
    }
    if (irreversible >= this.#quorum && missing === 0) {
      return Confirmation.IRREVERSIBLE;
    }
    if (missing >= this.#quorum && irreversible === 0) {
      return Confirmation.MISSING;
    }
    return Confirmation.PENDING;
  }

  /**
   * One node's view; an unreachable or inconsistent node counts as "not yet".
   * @param {ChainReader} verifier
   * @param {Transfer} transfer
   * @returns {Promise<Confirmation | "UNKNOWN">}
   */
  async #askNode(verifier, transfer) {
    try {
      const head = await verifier.getHead();
      if (transfer.blockNum > head.irreversibleBlock) {
        return Confirmation.PENDING;
      }
      const block = await verifier.getBlock(transfer.blockNum);
      if (block === null) {
        return "UNKNOWN";
      }
      const operation = block.transactions.find((transaction) => transaction.txId === transfer.txId)?.operations[transfer.opIndex];
      if (operation === undefined || operation.type !== "transfer") {
        return Confirmation.MISSING;
      }
      const onChain = toTransfer(operation.data, { txId: transfer.txId, opIndex: transfer.opIndex, blockNum: transfer.blockNum, time: transfer.time });
      return onChain !== null && sameTransfer(onChain, transfer) ? Confirmation.IRREVERSIBLE : Confirmation.MISSING;
    } catch {
      return "UNKNOWN";
    }
  }
}

/**
 * @param {Readonly<Record<string, unknown>>} data a transfer operation's fields
 * @param {{ txId: string, opIndex: number, blockNum: number, time: number }} where
 * @returns {Transfer | null} null when the operation is malformed (never pays anything)
 */
function toTransfer(data, where) {
  const amount = parseSteemAsset(data.amount);
  const { from, to, memo } = data;
  if (amount === null || typeof from !== "string" || typeof to !== "string" || !isValidAccountName(from) || !isValidAccountName(to) || typeof memo !== "string" || memo.length > MAX_MEMO_LENGTH) {
    return null;
  }
  return Object.freeze({ network: STEEM_NETWORK, ...where, from, to, asset: amount.asset, amount: amount.amount, memo });
}

/**
 * @param {Transfer} left
 * @param {Transfer} right
 */
function sameTransfer(left, right) {
  return left.from === right.from && left.to === right.to && left.asset === right.asset && left.amount === right.amount && left.memo === right.memo;
}
