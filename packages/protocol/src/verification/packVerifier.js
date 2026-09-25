/**
 * Verifies an order's packs from the chain (docs/tcg/03 §11.1, §12):
 *
 *   1. the order's receipt (`m8tcg_receipt`, every part, identical
 *      duplicates tolerated) signed by an authorised broadcaster;
 *   2. for each pack's epoch, the commitment and the reveal (`m8tcg_epoch`)
 *      signed by an authorised broadcaster, the secret matching the
 *      commitment, and the commitment published in an earlier block than the
 *      receipt (with the payment's block, when known, earlier than that too);
 *   3. each pack redrawn from its drop table (accepted only if it hashes to
 *      the receipt's `t`) with packSeed(secret, order, payment tx, index);
 *      every redrawn card must be among the receipt's cards.
 *
 * Network-neutral: operations come from a ChainReader, drop tables from
 * anywhere (they are checked by hash).
 */
import { CanonicalJsonError, parseCanonical } from "../canonical/CanonicalJson.js";
import { LIMITS, OperationId } from "../game/constants.js";
import { ProtocolError } from "../game/ProtocolError.js";
import { BroadcasterRegistry } from "../game/manifest.js";
import { FINISH_CODES } from "../receipts/receipts.js";
import { PackEpochKind, drawPack, dropTableHash, packEpochCommitment, packSeed } from "../packs/packs.js";

export const PackVerdict = Object.freeze({
  VALID: "VALID",
  NOT_FOUND: "NOT_FOUND",
  NOT_REVEALED: "NOT_REVEALED",
  INVALID: "INVALID",
});

const PAGE_SIZE = 1000;

/**
 * @typedef {import("../game/OperationDecoder.js").ChainOperation} ChainOperation
 * @typedef {Readonly<{ json: Record<string, any>, blockNum: number }>} Signed
 */

/**
 * @param {ChainOperation} operation
 * @param {(account: string, blockNum: number) => boolean} authorized
 * @returns {Signed | null}
 */
function readSigned(operation, authorized) {
  const signer = operation.requiredPostingAuths.length === 1 && operation.requiredAuths.length === 0 ? operation.requiredPostingAuths[0] : null;
  if (signer === null || !authorized(signer, operation.blockNum)) {
    return null;
  }
  try {
    const json = parseCanonical(operation.json, { maxBytes: LIMITS.MAX_OPERATION_BYTES });
    return json !== null && typeof json === "object" && !Array.isArray(json) ? Object.freeze({ json: /** @type {Record<string, any>} */ (json), blockNum: operation.blockNum }) : null;
  } catch (error) {
    if (error instanceof CanonicalJsonError) {
      return null;
    }
    throw error;
  }
}

/**
 * A receipt part's fields other than its slice of cards.
 * @param {Record<string, any>} json
 */
const baseOf = (json) => JSON.stringify(Object.fromEntries(Object.entries(json).filter(([key]) => key !== "cards" && key !== "part")));

/**
 * Joins the receipt's parts; parts must agree on everything but their cards.
 * @param {readonly Signed[]} parts
 * @returns {{ receipt: Record<string, any>, cards: any[], blockNum: number } | { problem: string }}
 */
function assembleReceipt(parts) {
  const byPart = new Map();
  for (const part of parts) {
    const index = Array.isArray(part.json.part) ? part.json.part[0] : null;
    const existing = byPart.get(index);
    if (existing !== undefined && JSON.stringify(existing.json) !== JSON.stringify(part.json)) {
      return { problem: `two different receipts claim part ${index}` };
    }
    byPart.set(index, existing ?? part);
  }
  const first = [...byPart.values()][0];
  const total = Array.isArray(first.json.part) ? first.json.part[1] : 0;
  const base = baseOf(first.json);
  for (let index = 1; index <= total; index += 1) {
    const part = byPart.get(index);
    if (part === undefined) {
      return { problem: `receipt part ${index} of ${total} is not on chain (yet)` };
    }
    if (baseOf(part.json) !== base) {
      return { problem: `receipt part ${index} disagrees with part 1` };
    }
  }
  const ordered = [...byPart.entries()].sort(([left], [right]) => left - right).map(([, part]) => part);
  return { receipt: first.json, cards: ordered.flatMap((part) => part.json.cards), blockNum: Math.max(...ordered.map((part) => part.blockNum)) };
}

/**
 * The first authorised commitment and reveal of each epoch.
 * @param {readonly Signed[]} epochs
 */
function epochIndex(epochs) {
  /** @type {Map<number, { commit?: Signed, reveal?: Signed }>} */
  const index = new Map();
  for (const entry of [...epochs].sort((left, right) => left.blockNum - right.blockNum)) {
    const slot = index.get(entry.json.epoch) ?? {};
    if (entry.json.kind === PackEpochKind.COMMIT && slot.commit === undefined) {
      slot.commit = entry;
    } else if (entry.json.kind === PackEpochKind.REVEAL && slot.reveal === undefined) {
      slot.reveal = entry;
    }
    index.set(entry.json.epoch, slot);
  }
  return index;
}

/**
 * Takes every redrawn card out of the receipt's cards; false if one is missing.
 * @param {Map<string, number>} remaining definition:finishCode → count
 * @param {readonly { cardId: string, finish: string }[]} drawn
 */
function takeCards(remaining, drawn) {
  for (const card of drawn) {
    const key = `${card.cardId}:${FINISH_CODES[/** @type {keyof typeof FINISH_CODES} */ (card.finish)]}`;
    const count = remaining.get(key) ?? 0;
    if (count === 0) {
      return false;
    }
    remaining.set(key, count - 1);
  }
  return true;
}

/**
 * @param {unknown} table
 * @returns {string | null} null when it is not a valid drop table
 */
function hashOrNull(table) {
  try {
    return dropTableHash(/** @type {any} */ (table));
  } catch (error) {
    if (error instanceof ProtocolError) {
      return null;
    }
    throw error;
  }
}

/**
 * Checks one pack; returns its redrawn cards, or the verdict and why it fails.
 * @param {any} pack { epoch, idx, t } from the receipt
 * @param {{ orderId: string, txId: string, epochs: ReturnType<typeof epochIndex>, receiptBlock: number, paymentBlock: number | null, dropTables: ReadonlyMap<string, unknown>, remaining: Map<string, number> }} context
 * @returns {{ cards: readonly string[] } | { verdict: string, problem: string }}
 */
function checkPack(pack, { orderId, txId, epochs, receiptBlock, paymentBlock, dropTables, remaining }) {
  const epoch = epochs.get(pack.epoch);
  if (epoch?.commit === undefined) {
    return { verdict: PackVerdict.INVALID, problem: `epoch ${pack.epoch} has no commitment on chain` };
  }
  if (epoch.commit.blockNum >= receiptBlock || (paymentBlock !== null && epoch.commit.blockNum >= paymentBlock)) {
    return { verdict: PackVerdict.INVALID, problem: `epoch ${pack.epoch} was committed on chain only after the payment or the receipt` };
  }
  if (epoch.reveal === undefined) {
    return { verdict: PackVerdict.NOT_REVEALED, problem: `epoch ${pack.epoch} is not revealed yet: packs can be checked once its orders are all settled` };
  }
  const secret = epoch.reveal.json.secret;
  if (packEpochCommitment(secret) !== epoch.commit.json.commit) {
    return { verdict: PackVerdict.INVALID, problem: `the revealed secret of epoch ${pack.epoch} does not match its commitment` };
  }
  const table = dropTables.get(pack.t);
  if (table === undefined || hashOrNull(table) !== pack.t) {
    return { verdict: PackVerdict.INVALID, problem: `no drop table hashing to ${pack.t} was provided` };
  }
  const drawn = drawPack(/** @type {any} */ (table), packSeed({ secret, orderId, txId, index: pack.idx }));
  if (!takeCards(remaining, drawn)) {
    return { verdict: PackVerdict.INVALID, problem: `pack ${pack.idx} is not what its seed draws` };
  }
  return { cards: Object.freeze(drawn.map((card) => `${card.cardId}:${card.finish}`)) };
}

/**
 * @param {{
 *   orderId: string,
 *   operations: readonly ChainOperation[],
 *   isAuthorizedBroadcaster: (account: string, blockNum: number) => boolean,
 *   dropTables: ReadonlyMap<string, unknown>,
 *   paymentBlock?: number | null,
 * }} input `dropTables`: hash → table, from any source (checked against the hash)
 */
export function verifyOrderPacks({ orderId, operations, isAuthorizedBroadcaster, dropTables, paymentBlock = null }) {
  const signedOf = (id) => operations.filter((operation) => operation.id === id).map((operation) => readSigned(operation, isAuthorizedBroadcaster)).filter((entry) => entry !== null);
  const parts = signedOf(OperationId.RECEIPT).filter((entry) => entry.json.o === orderId);
  if (parts.length === 0) {
    return Object.freeze({ verdict: PackVerdict.NOT_FOUND, problem: "no receipt for this order from an authorised broadcaster" });
  }
  const assembled = assembleReceipt(parts);
  if ("problem" in assembled) {
    return Object.freeze({ verdict: PackVerdict.INVALID, problem: assembled.problem });
  }
  const { receipt, cards, blockNum: receiptBlock } = assembled;
  const remaining = new Map();
  for (const [, definitionId, , finish] of cards) {
    remaining.set(`${definitionId}:${finish}`, (remaining.get(`${definitionId}:${finish}`) ?? 0) + 1);
  }
  const context = { orderId, txId: receipt.pay.tx, epochs: epochIndex(signedOf(OperationId.EPOCH)), receiptBlock, paymentBlock, dropTables, remaining };
  const packs = [];
  for (const pack of receipt.packs) {
    const checked = checkPack(pack, context);
    if ("problem" in checked) {
      return Object.freeze({ verdict: checked.verdict, problem: checked.problem });
    }
    packs.push(Object.freeze({ index: pack.idx, epoch: pack.epoch, cards: checked.cards }));
  }
  const otherCards = [...remaining.values()].reduce((sum, count) => sum + count, 0);
  return Object.freeze({ verdict: PackVerdict.VALID, problem: null, packs: Object.freeze(packs), receipt: Object.freeze({ account: receipt.u, payment: receipt.pay, items: receipt.items, cards: cards.length, otherCards }) });
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
      break;
    }
    cursor = entries[entries.length - 1].index;
  }
  return found;
}

/**
 * Reads what verifyOrderPacks needs from the chain: the root's manifests,
 * then receipts and epochs from every authorised broadcaster's history
 * (irreversible blocks only).
 * @param {{ orderId: string, reader: import("./chainVerifier.js").ChainReader, rootAccount: string, dropTables: ReadonlyMap<string, unknown>, paymentBlock?: number | null, maxHistoryPages?: number }} input
 */
export async function verifyOrderOnChain({ orderId, reader, rootAccount, dropTables, paymentBlock = null, maxHistoryPages = 200 }) {
  const head = await reader.head();
  const irreversible = (operation) => operation.blockNum <= head.irreversibleBlock;
  const manifests = (await historyOperations(reader, rootAccount, new Set([OperationId.MANIFEST]), maxHistoryPages)).filter(irreversible);
  const { registry } = BroadcasterRegistry.fromOperations(manifests, rootAccount);
  const operations = [];
  for (const account of registry.accounts()) {
    const published = await historyOperations(reader, account, new Set([OperationId.RECEIPT, OperationId.EPOCH]), maxHistoryPages);
    operations.push(...published.filter((operation) => irreversible(operation) && (operation.id === OperationId.EPOCH || operation.json.includes(orderId))));
  }
  return Object.freeze({ ...verifyOrderPacks({ orderId, operations, isAuthorizedBroadcaster: registry.asPolicy(), dropTables, paymentBlock }), broadcasters: registry.accounts(), irreversibleBlock: head.irreversibleBlock });
}
