/**
 * ChainBroadcaster: publishes BUILT outbox records (docs/tcg/03 §16).
 *
 * One round per block (3 s). Only broadcasters the root account's manifest
 * authorises at the irreversible block publish (a record signed before its
 * signer's authorisation would be invalid forever). Each sends at most one
 * operation per round: its oldest record (a receipt part, a pack epoch, a
 * trade, a sale or a game result), alone. Records are partitioned among the
 * accounts by order (or game), so an order's receipts leave in order from the
 * same account.
 *
 * Persist first, broadcast second: the signed transaction and the records it
 * carries are written as BROADCAST before anything reaches a node. A crash
 * in between leaves a transaction the tracker will find on chain (INCLUDED)
 * or see expire (records BUILT again) — never an unknown one. A broadcast
 * error proves nothing either way, so it is only noted: the tracker decides.
 */
import { OperationId, sha256Hex, utf8 } from "@magic8/protocol";
import { uuidV4 } from "../../../kernel/random.js";
import { OutboxKind } from "./ChainOutbox.js";
import { ResourceMode } from "./RcMonitor.js";

export const DEFAULT_BROADCAST_POLICY = Object.freeze({
  /** BUILT records looked at per round. */
  maxRowsPerRound: 200,
});

const OPERATION_OF_KIND = Object.freeze({ [OutboxKind.RECEIPT]: OperationId.RECEIPT, [OutboxKind.EPOCH]: OperationId.EPOCH, [OutboxKind.TRADE]: OperationId.TRADE, [OutboxKind.SALE]: OperationId.SALE, [OutboxKind.RESULT]: OperationId.RESULT });
const PURPOSE_OF_KIND = Object.freeze({ [OutboxKind.RECEIPT]: "RECEIPT", [OutboxKind.EPOCH]: "EPOCH", [OutboxKind.TRADE]: "TRADE", [OutboxKind.SALE]: "SALE", [OutboxKind.RESULT]: "RESULT" });

/**
 * @typedef {import("../infrastructure/PgChainRepository.js").OutboxRow} OutboxRow
 * @typedef {Readonly<{ kind: string, id: string, json: string, rows: readonly OutboxRow[] }>} Batch
 */

/**
 * The broadcaster that publishes a record: stable for an order (or a game).
 * @param {OutboxRow} row
 * @param {readonly string[]} signers
 */
export function signerFor(row, signers) {
  const key = row.orderId ?? row.gameId ?? row.kind;
  return signers[Number.parseInt(sha256Hex(utf8(key)).slice(0, 8), 16) % signers.length];
}

/**
 * The expected operation JSON of a transaction's records: the payload of its one record.
 * @param {readonly { payload: string }[]} rows
 * @returns {string | null} null when they cannot form one operation
 */
export function operationJson(rows) {
  return rows.length === 1 ? rows[0].payload : null;
}

/**
 * @param {readonly OutboxRow[]} own a signer's BUILT rows, most urgent first
 * @returns {Batch | null}
 */
function nextBatch(own) {
  const [first] = own;
  return first === undefined ? null : Object.freeze({ kind: first.kind, id: OPERATION_OF_KIND[first.kind], json: first.payload, rows: Object.freeze([first]) });
}

export class ChainBroadcaster {
  #repository;
  #transactions;
  #resources;
  #authorization;
  #clock;
  #random;
  #unitOfWork;
  #logger;
  #policy;

  /**
   * @param {{
   *   repository: import("../infrastructure/PgChainRepository.js").PgChainRepository,
   *   transactions: import("./ports.js").TransactionProvider,
   *   resources: { modeOf: (signer: string) => string },
   *   authorization: { isAuthorized: (signer: string) => boolean },
   *   clock: import("../../../kernel/time.js").Clock,
   *   random: import("../../../kernel/random.js").SecureRandom,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   logger: import("../../../kernel/logger.js").Logger,
   *   policy?: Partial<typeof DEFAULT_BROADCAST_POLICY>,
   * }} deps
   */
  constructor({ repository, transactions, resources, authorization, clock, random, unitOfWork, logger, policy = {} }) {
    this.#repository = repository;
    this.#transactions = transactions;
    this.#resources = resources;
    this.#authorization = authorization;
    this.#clock = clock;
    this.#random = random;
    this.#unitOfWork = unitOfWork;
    this.#logger = logger;
    this.#policy = Object.freeze({ ...DEFAULT_BROADCAST_POLICY, ...policy });
  }

  /**
   * One round: sign, persist, then broadcast.
   * @returns {Promise<number>} transactions sent
   */
  async runOnce() {
    const all = this.#transactions.signers;
    const active = all.filter((signer) => this.#resources.modeOf(signer) !== ResourceMode.PAUSED && this.#authorization.isAuthorized(signer));
    if (active.length === 0) {
      return 0;
    }
    const reference = await this.#transactions.reference();
    const prepared = await this.#unitOfWork(() => this.#prepare(all, active, reference));
    for (const { id, transaction, signer } of prepared) {
      try {
        await this.#transactions.broadcast(transaction);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.#logger.warn("broadcast failed; the tracker will retry after the transaction expires", { signer, error: message });
        await this.#repository.setTransactionError(id, message, this.#clock.now());
      }
    }
    return prepared.length;
  }

  /**
   * @param {readonly string[]} all every signer (records keep their partition when one is paused)
   * @param {readonly string[]} active signers that may send now
   * @param {import("./ports.js").BlockReference} reference
   */
  async #prepare(all, active, reference) {
    const network = this.#transactions.network;
    const rows = await this.#repository.lockBuilt(network, this.#policy.maxRowsPerRound);
    /** @type {Map<string, OutboxRow[]>} */
    const bySigner = new Map();
    for (const row of rows) {
      const signer = signerFor(row, all);
      bySigner.set(signer, [...(bySigner.get(signer) ?? []), row]);
    }
    const prepared = [];
    for (const signer of active) {
      const batch = nextBatch(bySigner.get(signer) ?? []);
      if (batch === null) {
        continue;
      }
      const signed = this.#transactions.signCustomJson({ reference, signer, id: batch.id, json: batch.json });
      const id = uuidV4(this.#random);
      await this.#repository.insertTransaction(
        { id, network, txId: signed.txId, purpose: PURPOSE_OF_KIND[batch.kind], signer, expiration: signed.expiration, signedTx: signed.transaction, at: this.#clock.now() },
        batch.rows.map((row) => row.id),
      );
      prepared.push({ id, transaction: signed.transaction, signer });
    }
    return prepared;
  }
}
