/**
 * ChainTracker: follows what the broadcasters published and reconciles it
 * with the database (docs/tcg/03 §15–16).
 *
 * For each broadcaster, one round:
 *   1. reads the head (and the last irreversible block) first;
 *   2. reads the account's history from a persistent cursor: each of our
 *      operations must be a transaction the database knows, carrying
 *      exactly the record it says (MATCH → INCLUDED). An operation signed by
 *      our broadcaster that the database does not know means a leaked key or
 *      a bug (UNKNOWN_ON_CHAIN); a record whose bytes differ from ours is a
 *      CONFLICT. Both raise an alert;
 *   3. confirms INCLUDED transactions below the irreversible block by
 *      reading their block (a micro-fork may have dropped them);
 *   4. once the history is read to its end, expires the transactions whose
 *      expiration is older than the irreversible block's time: they can
 *      never be included, so their records go back to BUILT and are sent
 *      again, byte for byte (MISSING_ON_CHAIN). Too many attempts raise an
 *      alert.
 */
import { OperationId } from "@magic8/protocol";
import { operationJson } from "./ChainBroadcaster.js";

export const DEFAULT_TRACKER_POLICY = Object.freeze({
  pageSize: 1000,
  maxPagesPerRound: 5,
  blockIntervalMs: 3000,
  maxAttempts: 5,
});

/** @type {ReadonlySet<string>} */
const OUR_OPERATIONS = Object.freeze(new Set([OperationId.RECEIPT, OperationId.EPOCH, OperationId.TRADE, OperationId.SALE, OperationId.RESULT]));

export const AlertKind = Object.freeze({
  UNKNOWN_ON_CHAIN: "UNKNOWN_ON_CHAIN",
  CONFLICT: "CONFLICT",
  REPEATED_REBROADCAST: "REPEATED_REBROADCAST",
  RC_CRITICAL: "RC_CRITICAL",
});

export class ChainTracker {
  #repository;
  #reader;
  #signers;
  #clock;
  #unitOfWork;
  #logger;
  #policy;

  /**
   * @param {{
   *   repository: import("../infrastructure/PgChainRepository.js").PgChainRepository,
   *   reader: import("./ports.js").PublicationReader,
   *   signers: readonly string[],
   *   clock: import("../../../kernel/time.js").Clock,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   logger: import("../../../kernel/logger.js").Logger,
   *   policy?: Partial<typeof DEFAULT_TRACKER_POLICY>,
   * }} deps
   */
  constructor({ repository, reader, signers, clock, unitOfWork, logger, policy = {} }) {
    this.#repository = repository;
    this.#reader = reader;
    this.#signers = Object.freeze([...signers]);
    this.#clock = clock;
    this.#unitOfWork = unitOfWork;
    this.#logger = logger;
    this.#policy = Object.freeze({ ...DEFAULT_TRACKER_POLICY, ...policy });
  }

  async runOnce() {
    for (const signer of this.#signers) {
      try {
        await this.#track(signer);
      } catch (error) {
        this.#logger.error("chain tracking failed", { signer, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  /** @param {string} signer */
  async #track(signer) {
    const head = await this.#reader.head();
    const caughtUp = await this.#follow(signer);
    await this.#confirm(signer, head);
    if (caughtUp) {
      await this.#expire(signer, head);
    }
  }

  get #network() {
    return this.#reader.network;
  }

  /**
   * @param {string} signer
   * @returns {Promise<boolean>} true when the history was read to its end
   */
  async #follow(signer) {
    const name = `tracker:${this.#network}:${signer}`;
    let cursor = (await this.#repository.getCursor(name)) ?? -1;
    for (let page = 0; page < this.#policy.maxPagesPerRound; page += 1) {
      const entries = await this.#reader.publications(signer, cursor, this.#policy.pageSize);
      for (const { operation } of entries) {
        if (operation !== null && OUR_OPERATIONS.has(operation.id) && operation.requiredPostingAuths.includes(signer)) {
          await this.#unitOfWork(() => this.#observe(operation));
        }
      }
      if (entries.length > 0) {
        cursor = entries[entries.length - 1].index;
        await this.#repository.setCursor(name, this.#network, cursor, this.#clock.now());
      }
      if (entries.length < this.#policy.pageSize) {
        return true;
      }
    }
    return false;
  }

  /** @param {import("@magic8/protocol").ChainOperation} operation */
  async #observe(operation) {
    const where = { txId: operation.txId, blockNum: operation.blockNum, id: operation.id };
    const transaction = await this.#repository.findTransaction(this.#network, operation.txId);
    if (transaction === null) {
      await this.#alert(AlertKind.UNKNOWN_ON_CHAIN, `${operation.txId}:${operation.opIndex}`, where);
      return;
    }
    if (operationJson(await this.#repository.rowsOf(transaction.id)) !== operation.json) {
      await this.#alert(AlertKind.CONFLICT, `${operation.txId}:${operation.opIndex}`, { ...where, reason: "the operation does not carry the records of its transaction" });
      return;
    }
    await this.#repository.markIncluded(transaction.id, operation.blockNum, this.#clock.now());
  }

  /**
   * @param {string} signer
   * @param {import("./ports.js").ChainHead} head
   */
  async #confirm(signer, head) {
    for (const transaction of await this.#repository.openTransactions(this.#network, signer)) {
      if (transaction.status !== "INCLUDED" || transaction.blockNum === null || transaction.blockNum > head.irreversibleBlock) {
        continue;
      }
      const operations = await this.#reader.blockOperations(transaction.blockNum);
      if (operations === null) {
        continue;
      }
      if (operations.some((operation) => operation.txId === transaction.txId)) {
        await this.#unitOfWork(() => this.#repository.markIrreversible(transaction.id, this.#clock.now()));
      } else {
        this.#logger.warn("a transaction left its block before it became irreversible", { signer, txId: transaction.txId, block: transaction.blockNum });
        await this.#unitOfWork(() => this.#repository.markUnconfirmed(transaction.id, this.#clock.now()));
      }
    }
  }

  /**
   * @param {string} signer
   * @param {import("./ports.js").ChainHead} head
   */
  async #expire(signer, head) {
    const irreversibleTime = head.time - (head.headBlock - head.irreversibleBlock) * this.#policy.blockIntervalMs;
    for (const transaction of await this.#repository.openTransactions(this.#network, signer)) {
      if (transaction.status !== "BROADCAST" || transaction.expiration >= irreversibleTime) {
        continue;
      }
      const released = await this.#unitOfWork(() => this.#repository.markExpired(transaction.id, this.#clock.now()));
      this.#logger.warn("a transaction expired without being included; its records will be sent again", { signer, txId: transaction.txId, records: released.length });
      for (const row of released.filter((candidate) => candidate.attempts >= this.#policy.maxAttempts)) {
        await this.#alert(AlertKind.REPEATED_REBROADCAST, String(row.id), { signer, row: row.id, attempts: row.attempts, kind: row.kind, orderId: row.orderId, gameId: row.gameId });
      }
    }
  }

  /**
   * @param {string} kind
   * @param {string} fingerprint
   * @param {Readonly<Record<string, unknown>>} details
   */
  async #alert(kind, fingerprint, details) {
    if (await this.#repository.insertAlert({ network: this.#network, kind, fingerprint, details, at: this.#clock.now() })) {
      this.#logger.error(`chain alert: ${kind}`, { fingerprint, ...details });
    }
  }
}
