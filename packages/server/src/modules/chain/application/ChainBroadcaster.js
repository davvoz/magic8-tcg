/**
 * ChainBroadcaster: publishes BUILT outbox records (docs/tcg/03 §9).
 *
 * One round per block (3 s). Only broadcasters the root account's manifest
 * authorises at the irreversible block publish (a record signed before its
 * signer's authorisation would be invalid forever). Each sends at most one
 * operation per round: the most urgent of its records — a receipt or a pack
 * epoch alone, or as many game records as fit one envelope. Records are
 * partitioned among the accounts by game (or order), so a game's records
 * leave in order from the same account.
 *
 * Persist first, broadcast second: the signed transaction and the records it
 * carries are written as BROADCAST before anything reaches a node. A crash
 * in between leaves a transaction the tracker will find on chain (INCLUDED)
 * or see expire (records BUILT again) — never an unknown one. A broadcast
 * error proves nothing either way, so it is only noted: the tracker decides.
 */
import { OperationId, packEnvelopes, sha256Hex, utf8 } from "@magic8/protocol";
import { uuidV4 } from "../../../kernel/random.js";
import { OutboxKind } from "./ChainOutbox.js";
import { ResourceMode } from "./RcMonitor.js";

export const DEFAULT_BROADCAST_POLICY = Object.freeze({
  /** BUILT records looked at per round. */
  maxRowsPerRound: 200,
  /** A broadcaster low on Resource Credits sends game records once every this many rounds, so they pack into fuller envelopes. */
  slowEveryRounds: 10,
});

const OPERATION_OF_KIND = Object.freeze({ [OutboxKind.GAME_RECORD]: OperationId.GAME, [OutboxKind.RECEIPT]: OperationId.RECEIPT, [OutboxKind.EPOCH]: OperationId.EPOCH, [OutboxKind.TRADE]: OperationId.TRADE });
const PURPOSE_OF_KIND = Object.freeze({ [OutboxKind.GAME_RECORD]: "GAME_RECORDS", [OutboxKind.RECEIPT]: "RECEIPT", [OutboxKind.EPOCH]: "EPOCH", [OutboxKind.TRADE]: "TRADE" });

/**
 * @typedef {import("../infrastructure/PgChainRepository.js").OutboxRow} OutboxRow
 * @typedef {Readonly<{ kind: string, id: string, json: string, rows: readonly OutboxRow[] }>} Batch
 */

/**
 * The broadcaster that publishes a record: stable for a game (or an order).
 * @param {OutboxRow} row
 * @param {readonly string[]} signers
 */
export function signerFor(row, signers) {
  const key = row.gameId ?? row.orderId ?? row.kind;
  return signers[Number.parseInt(sha256Hex(utf8(key)).slice(0, 8), 16) % signers.length];
}

/**
 * The expected operation JSON for records sent together: an envelope for
 * game records, the payload itself for a receipt or an epoch.
 * @param {string} kind
 * @param {readonly { payload: string }[]} rows
 * @returns {string | null} null when they cannot form one operation
 */
export function operationJson(kind, rows) {
  if (rows.length === 0) {
    return null;
  }
  if (kind !== OutboxKind.GAME_RECORD) {
    return rows.length === 1 ? rows[0].payload : null;
  }
  const envelopes = packEnvelopes(rows.map((row) => ({ json: row.payload })));
  return envelopes.length === 1 ? envelopes[0].json : null;
}

/**
 * @param {readonly OutboxRow[]} own a signer's BUILT rows, most urgent first
 * @param {boolean} holdGameRecords
 * @returns {Batch | null}
 */
function nextBatch(own, holdGameRecords) {
  const single = own.find((row) => row.kind !== OutboxKind.GAME_RECORD);
  const games = own.filter((row) => row.kind === OutboxKind.GAME_RECORD);
  if (single !== undefined && (single === own[0] || holdGameRecords || games.length === 0)) {
    return Object.freeze({ kind: single.kind, id: OPERATION_OF_KIND[single.kind], json: single.payload, rows: Object.freeze([single]) });
  }
  if (holdGameRecords || games.length === 0) {
    return null;
  }
  const [envelope] = packEnvelopes(games.map((row) => ({ json: row.payload })));
  return Object.freeze({ kind: OutboxKind.GAME_RECORD, id: OperationId.GAME, json: envelope.json, rows: Object.freeze(games.slice(0, envelope.count)) });
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
  #round = 0;

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
    this.#round += 1;
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
    const slowRound = this.#round % this.#policy.slowEveryRounds === 0;
    for (const signer of active) {
      const holdGameRecords = this.#resources.modeOf(signer) === ResourceMode.SLOW && !slowRound;
      const batch = nextBatch(bySigner.get(signer) ?? [], holdGameRecords);
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
