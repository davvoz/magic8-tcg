/**
 * Provenance of one copy of a card, from the chain alone (docs/tcg/13):
 * the receipt that minted it for a buyer (m8tcg_receipt), then every trade
 * that moved it (m8tcg_trade), in chain order. Each trade must be given by
 * whoever owned the copy at that point and name the same printing; the
 * last receiver is the owner today.
 *
 * Only bought copies have a provenance: free grants are not published, and
 * cannot be traded.
 */
import { CanonicalJsonError, parseCanonical } from "../canonical/CanonicalJson.js";
import { LIMITS, OperationId } from "../game/constants.js";
import { BroadcasterRegistry } from "../game/manifest.js";
import { FINISH_CODES } from "../receipts/receipts.js";
import { parseTradeRecord } from "../trades/trades.js";

export const ProvenanceVerdict = Object.freeze({
  /** Minted once, and every trade was given by its owner of the moment. */
  VALID: "VALID",
  /** No receipt names the copy: a free grant, or not published (yet). */
  UNKNOWN: "UNKNOWN",
  /** The chain contradicts itself about the copy. */
  INVALID: "INVALID",
});

const PAGE_SIZE = 1000;
const FINISH_NAMES = Object.freeze(Object.fromEntries(Object.entries(FINISH_CODES).map(([name, code]) => [code, name])));

/**
 * @typedef {import("../game/OperationDecoder.js").ChainOperation} ChainOperation
 * @typedef {Readonly<{ tradeId: string, from: string, to: string, blockNum: number }>} Transfer
 */

/**
 * The payload of an operation signed (posting) by an authorised broadcaster, or null.
 * @param {ChainOperation} operation
 * @param {(account: string, blockNum: number) => boolean} isAuthorizedBroadcaster
 */
function signedJson(operation, isAuthorizedBroadcaster) {
  const signer = operation.requiredPostingAuths.length === 1 && operation.requiredAuths.length === 0 ? operation.requiredPostingAuths[0] : null;
  if (signer === null || !isAuthorizedBroadcaster(signer, operation.blockNum)) {
    return null;
  }
  try {
    const json = parseCanonical(operation.json, { maxBytes: LIMITS.MAX_OPERATION_BYTES });
    return json !== null && typeof json === "object" && !Array.isArray(json) ? /** @type {Record<string, any>} */ (json) : null;
  } catch (error) {
    if (error instanceof CanonicalJsonError) {
      return null;
    }
    throw error;
  }
}

/**
 * @param {string} problem
 * @param {object} [partial]
 */
const invalid = (problem, partial = {}) => Object.freeze({ verdict: ProvenanceVerdict.INVALID, problem, copy: null, minted: null, transfers: Object.freeze([]), owner: null, ...partial });

/**
 * Where the copy was minted: exactly one order may name it.
 * @param {string} copyId
 * @param {readonly { json: Record<string, any>, blockNum: number }[]} receipts
 */
function findMint(copyId, receipts) {
  const mints = new Map();
  for (const { json, blockNum } of receipts) {
    const card = Array.isArray(json.cards) ? json.cards.find((entry) => Array.isArray(entry) && entry[0] === copyId) : undefined;
    if (card !== undefined && typeof json.o === "string" && typeof json.u === "string") {
      const previous = mints.get(json.o);
      mints.set(json.o, previous === undefined || previous.blockNum > blockNum ? { order: json.o, account: json.u, card, blockNum } : previous);
    }
  }
  return [...mints.values()];
}

/**
 * @param {{ copyId: string, operations: readonly ChainOperation[], isAuthorizedBroadcaster: (account: string, blockNum: number) => boolean }} input
 *   operations: receipts and trades (others are ignored), from any source
 */
export function traceCopy({ copyId, operations, isAuthorizedBroadcaster }) {
  const collected = collect(operations, isAuthorizedBroadcaster);
  if ("problem" in collected) {
    return invalid(collected.problem);
  }
  const mints = findMint(copyId, collected.receipts);
  if (mints.length === 0) {
    return Object.freeze({ verdict: ProvenanceVerdict.UNKNOWN, problem: "no published receipt names this copy", copy: null, minted: null, transfers: Object.freeze([]), owner: null });
  }
  if (mints.length > 1) {
    return invalid(`minted by ${mints.length} different orders`);
  }
  return walkTrades(copyId, mints[0], collected.trades);
}

/**
 * The authorised receipts and trades, in chain order; a trade published twice counts once, and two different records for one trade are a problem.
 * @param {readonly ChainOperation[]} operations
 * @param {(account: string, blockNum: number) => boolean} isAuthorizedBroadcaster
 * @returns {{ receipts: { json: Record<string, any>, blockNum: number }[], trades: { trade: Record<string, any>, blockNum: number }[] } | { problem: string }}
 */
function collect(operations, isAuthorizedBroadcaster) {
  const ordered = [...operations].sort((left, right) => left.blockNum - right.blockNum || left.opIndex - right.opIndex);
  const receipts = [];
  /** @type {Map<string, { trade: Record<string, any>, json: string, blockNum: number }>} */
  const trades = new Map();
  for (const operation of ordered) {
    const json = operation.id === OperationId.RECEIPT || operation.id === OperationId.TRADE ? signedJson(operation, isAuthorizedBroadcaster) : null;
    if (json === null) {
      continue;
    }
    if (operation.id === OperationId.RECEIPT) {
      receipts.push({ json, blockNum: operation.blockNum });
    } else {
      const problem = addTrade(trades, operation);
      if (problem !== null) {
        return { problem };
      }
    }
  }
  return { receipts, trades: [...trades.values()] };
}

/**
 * Keeps one record per trade id.
 * @param {Map<string, { trade: Record<string, any>, json: string, blockNum: number }>} trades
 * @param {ChainOperation} operation
 * @returns {string | null} a problem
 */
function addTrade(trades, operation) {
  const trade = parseTradeRecord(operation.json);
  if (trade === null) {
    return null;
  }
  const known = trades.get(trade.t);
  if (known === undefined) {
    trades.set(trade.t, { trade, json: operation.json, blockNum: operation.blockNum });
    return null;
  }
  return known.json === operation.json ? null : `two different records for trade ${trade.t}`;
}

/**
 * @param {string} copyId
 * @param {{ order: string, account: string, card: any[], blockNum: number }} mint
 * @param {readonly { trade: Record<string, any>, blockNum: number }[]} trades in chain order
 */
function walkTrades(copyId, mint, trades) {
  const [, definitionId, serial, finishCode] = mint.card;
  const copy = Object.freeze({ id: copyId, definitionId, serial, finish: FINISH_NAMES[finishCode] ?? finishCode });
  const minted = Object.freeze({ account: mint.account, order: mint.order, blockNum: mint.blockNum });
  let owner = mint.account;
  const transfers = [];
  for (const { trade, blockNum } of trades) {
    const side = ["a", "b"].find((name) => trade[name].cards.some((/** @type {any[]} */ entry) => entry[0] === copyId));
    if (side === undefined) {
      continue;
    }
    const entry = trade[side].cards.find((/** @type {any[]} */ candidate) => candidate[0] === copyId);
    const [giver, receiver] = side === "a" ? [trade.a.u, trade.b.u] : [trade.b.u, trade.a.u];
    const partial = { copy, minted, transfers: Object.freeze([...transfers]), owner };
    if (blockNum < mint.blockNum) {
      return invalid(`trade ${trade.t} moves the copy before it was minted`, partial);
    }
    if (entry[1] !== definitionId || entry[2] !== serial || entry[3] !== finishCode) {
      return invalid(`trade ${trade.t} names another printing of the copy`, partial);
    }
    if (giver !== owner) {
      return invalid(`trade ${trade.t} has @${giver} give a copy @${owner} owned`, partial);
    }
    transfers.push(Object.freeze({ tradeId: trade.t, from: giver, to: receiver, blockNum }));
    owner = receiver;
  }
  return Object.freeze({ verdict: ProvenanceVerdict.VALID, problem: null, copy, minted, transfers: Object.freeze(transfers), owner });
}

/**
 * Every custom_json with one of `ids` in an account's history.
 * @param {import("./chainVerifier.js").ChainReader} reader
 * @param {string} account
 * @param {ReadonlySet<string>} ids
 * @param {number} maxPages
 */
async function historyOperations(reader, account, ids, maxPages) {
  const found = [];
  let cursor = -1;
  for (let page = 0; page < maxPages; page += 1) {
    const entries = await reader.publications(account, cursor, PAGE_SIZE);
    found.push(...entries.map((entry) => entry.operation).filter((operation) => operation !== null && ids.has(operation.id)));
    if (entries.length < PAGE_SIZE) {
      return { operations: found, complete: true };
    }
    cursor = entries[entries.length - 1].index;
  }
  return { operations: found, complete: false };
}

/**
 * Reads what traceCopy needs from the chain: the root's manifests, then the
 * receipts and trades naming the copy in every authorised broadcaster's
 * history (irreversible blocks only).
 * @param {{ copyId: string, reader: import("./chainVerifier.js").ChainReader, rootAccount: string, maxHistoryPages?: number }} input
 */
export async function verifyCopyOnChain({ copyId, reader, rootAccount, maxHistoryPages = 200 }) {
  const head = await reader.head();
  const irreversible = (/** @type {ChainOperation} */ operation) => operation.blockNum <= head.irreversibleBlock;
  const manifests = await historyOperations(reader, rootAccount, new Set([OperationId.MANIFEST]), maxHistoryPages);
  const { registry } = BroadcasterRegistry.fromOperations(manifests.operations.filter(irreversible), rootAccount);
  const operations = [];
  let complete = manifests.complete;
  for (const account of registry.accounts()) {
    const published = await historyOperations(reader, account, new Set([OperationId.RECEIPT, OperationId.TRADE]), maxHistoryPages);
    operations.push(...published.operations.filter((operation) => irreversible(operation) && operation.json.includes(copyId)));
    complete &&= published.complete;
  }
  return Object.freeze({ ...traceCopy({ copyId, operations, isAuthorizedBroadcaster: registry.asPolicy() }), broadcasters: registry.accounts(), irreversibleBlock: head.irreversibleBlock, complete });
}
