/**
 * blockchain_events (the outbox), blockchain_transactions, chain_cursors and
 * chain_alerts, as the broadcaster and the tracker use them. A record's
 * bytes never change (database trigger); only its anchoring state does:
 * BUILT → BROADCAST → INCLUDED → IRREVERSIBLE, back to BUILT when its
 * transaction expired without being included.
 */
import { fromTimestamp, toTimestamp } from "../../../platform/db/Database.js";

/**
 * @typedef {Readonly<{ id: number, kind: string, gameId: string | null, orderId: string | null, recordSeq: number | null, payload: string, priority: number, attempts: number }>} OutboxRow
 * @typedef {Readonly<{ id: string, txId: string, signer: string, status: string, blockNum: number | null, expiration: number }>} StoredTransaction
 */

/** @param {import("../../../platform/db/Database.js").Row} row @returns {OutboxRow} */
const toRow = (row) =>
  Object.freeze({ id: row.id, kind: row.kind, gameId: row.game_id, orderId: row.order_id, recordSeq: row.record_seq, payload: row.payload, priority: row.priority, attempts: row.attempts });

/** @param {import("../../../platform/db/Database.js").Row} row @returns {StoredTransaction} */
const toTransaction = (row) =>
  Object.freeze({ id: row.id, txId: row.tx_id, signer: row.signer, status: row.status, blockNum: row.block_num, expiration: fromTimestamp(row.expiration) });

export class PgChainRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  /**
   * BUILT records, most urgent first, locked for this unit of work; rows
   * another worker holds are skipped, never waited for.
   * @param {string} network
   * @param {number} limit
   */
  async lockBuilt(network, limit) {
    const rows = await this.#db.rows("SELECT * FROM blockchain_events WHERE network = $1 AND status = 'BUILT' ORDER BY priority, id LIMIT $2 FOR UPDATE SKIP LOCKED", [network, limit]);
    return Object.freeze(rows.map(toRow));
  }

  /**
   * @param {{ id: string, network: string, txId: string, purpose: string, signer: string, expiration: number, signedTx: unknown, at: number }} transaction
   * @param {readonly number[]} rowIds records it carries
   */
  async insertTransaction({ id, network, txId, purpose, signer, expiration, signedTx, at }, rowIds) {
    await this.#db.query(
      "INSERT INTO blockchain_transactions (id, network, tx_id, purpose, signer, status, expiration, signed_tx, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 'BROADCAST', $6, $7, $8, $8)",
      [id, network, txId, purpose, signer, toTimestamp(expiration), JSON.stringify(signedTx), toTimestamp(at)],
    );
    await this.#db.query("UPDATE blockchain_events SET status = 'BROADCAST', transaction_id = $2, attempts = attempts + 1, reconciliation = NULL WHERE id = ANY($1::bigint[])", [rowIds, id]);
  }

  /**
   * @param {string} id
   * @param {string} message
   * @param {number} at
   */
  async setTransactionError(id, message, at) {
    await this.#db.query("UPDATE blockchain_transactions SET last_error = $2, updated_at = $3 WHERE id = $1", [id, message.slice(0, 500), toTimestamp(at)]);
  }

  /**
   * @param {string} network
   * @param {string} txId
   * @returns {Promise<StoredTransaction | null>}
   */
  async findTransaction(network, txId) {
    const row = await this.#db.maybeOne("SELECT * FROM blockchain_transactions WHERE network = $1 AND tx_id = $2", [network, txId]);
    return row === null ? null : toTransaction(row);
  }

  /**
   * @param {string} network
   * @param {string} signer
   * @returns {Promise<readonly StoredTransaction[]>}
   */
  async openTransactions(network, signer) {
    const rows = await this.#db.rows("SELECT * FROM blockchain_transactions WHERE network = $1 AND signer = $2 AND status IN ('BROADCAST', 'INCLUDED') ORDER BY created_at, id", [network, signer]);
    return Object.freeze(rows.map(toTransaction));
  }

  /**
   * The records a transaction carries, in the order they were packed.
   * @param {string} transactionId
   */
  async rowsOf(transactionId) {
    const rows = await this.#db.rows("SELECT * FROM blockchain_events WHERE transaction_id = $1 ORDER BY priority, id", [transactionId]);
    return Object.freeze(rows.map(toRow));
  }

  /**
   * @param {string} gameId
   * @param {number} recordSeq
   * @returns {Promise<string | null>} the record's canonical JSON
   */
  async gameRecordPayload(gameId, recordSeq) {
    const row = await this.#db.maybeOne("SELECT payload FROM blockchain_events WHERE game_id = $1 AND record_seq = $2", [gameId, recordSeq]);
    return row === null ? null : row.payload;
  }

  /**
   * @param {string} transactionId
   * @param {number} blockNum
   * @param {number} at
   */
  async markIncluded(transactionId, blockNum, at) {
    await this.#db.query("UPDATE blockchain_transactions SET status = 'INCLUDED', block_num = $2, updated_at = $3 WHERE id = $1 AND status <> 'IRREVERSIBLE'", [transactionId, blockNum, toTimestamp(at)]);
    await this.#db.query("UPDATE blockchain_events SET status = 'INCLUDED', reconciliation = 'MATCH' WHERE transaction_id = $1 AND status IN ('BUILT', 'BROADCAST')", [transactionId]);
  }

  /**
   * @param {string} transactionId
   * @param {number} at
   */
  async markIrreversible(transactionId, at) {
    await this.#db.query("UPDATE blockchain_transactions SET status = 'IRREVERSIBLE', updated_at = $2 WHERE id = $1", [transactionId, toTimestamp(at)]);
    await this.#db.query("UPDATE blockchain_events SET status = 'IRREVERSIBLE' WHERE transaction_id = $1", [transactionId]);
  }

  /**
   * The transaction left its block (micro-fork): it is pending again.
   * @param {string} transactionId
   * @param {number} at
   */
  async markUnconfirmed(transactionId, at) {
    await this.#db.query("UPDATE blockchain_transactions SET status = 'BROADCAST', block_num = NULL, updated_at = $2 WHERE id = $1", [transactionId, toTimestamp(at)]);
    await this.#db.query("UPDATE blockchain_events SET status = 'BROADCAST', reconciliation = NULL WHERE transaction_id = $1", [transactionId]);
  }

  /**
   * The transaction can no longer be included: its records wait for a new one.
   * @param {string} transactionId
   * @param {number} at
   * @returns {Promise<readonly OutboxRow[]>} the released records
   */
  async markExpired(transactionId, at) {
    await this.#db.query("UPDATE blockchain_transactions SET status = 'EXPIRED', updated_at = $2 WHERE id = $1", [transactionId, toTimestamp(at)]);
    const rows = await this.#db.rows(
      "UPDATE blockchain_events SET status = 'BUILT', transaction_id = NULL, reconciliation = 'MISSING_ON_CHAIN' WHERE transaction_id = $1 AND status = 'BROADCAST' RETURNING *",
      [transactionId],
    );
    return Object.freeze(rows.map(toRow));
  }

  /**
   * @param {string} gameId
   * @param {number} recordSeq
   */
  async markConflict(gameId, recordSeq) {
    await this.#db.query("UPDATE blockchain_events SET reconciliation = 'CONFLICT' WHERE game_id = $1 AND record_seq = $2", [gameId, recordSeq]);
  }

  /** @param {string} name */
  async getCursor(name) {
    const row = await this.#db.maybeOne("SELECT position FROM chain_cursors WHERE name = $1", [name]);
    return row === null ? null : Number(row.position.index);
  }

  /**
   * @param {string} name
   * @param {string} network
   * @param {number} index
   * @param {number} at
   */
  async setCursor(name, network, index, at) {
    await this.#db.query(
      `INSERT INTO chain_cursors (name, network, position, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO UPDATE SET position = $3, updated_at = $4
       WHERE (chain_cursors.position->>'index')::bigint < ($3::jsonb->>'index')::bigint`,
      [name, network, JSON.stringify({ index }), toTimestamp(at)],
    );
  }

  /**
   * Records an anomaly once per fingerprint.
   * @param {{ network: string, kind: string, fingerprint: string, details: Readonly<Record<string, unknown>>, at: number }} alert
   * @returns {Promise<boolean>} false when it was already recorded
   */
  async insertAlert({ network, kind, fingerprint, details, at }) {
    const row = await this.#db.maybeOne(
      "INSERT INTO chain_alerts (network, kind, fingerprint, details, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (network, kind, fingerprint) WHERE fingerprint <> '' DO NOTHING RETURNING id",
      [network, kind, fingerprint, JSON.stringify(details), toTimestamp(at)],
    );
    return row !== null;
  }

  /**
   * Open alerts first, then the most recently resolved ones.
   * @param {number} limit
   */
  async listAlerts(limit) {
    const rows = await this.#db.rows("SELECT * FROM chain_alerts ORDER BY resolved_at IS NOT NULL, id DESC LIMIT $1", [limit]);
    return Object.freeze(
      rows.map((row) => Object.freeze({ id: row.id, network: row.network, kind: row.kind, fingerprint: row.fingerprint, details: row.details, createdAt: fromTimestamp(row.created_at), resolvedAt: row.resolved_at === null ? null : fromTimestamp(row.resolved_at) })),
    );
  }

  /**
   * @param {number} id
   * @param {number} at
   * @returns {Promise<Readonly<{ kind: string, fingerprint: string }> | null>} null when unknown or already resolved
   */
  async resolveAlert(id, at) {
    const row = await this.#db.maybeOne("UPDATE chain_alerts SET resolved_at = $2 WHERE id = $1 AND resolved_at IS NULL RETURNING kind, fingerprint", [id, toTimestamp(at)]);
    return row === null ? null : Object.freeze({ kind: row.kind, fingerprint: row.fingerprint });
  }

  /**
   * @param {string} network
   * @returns {Promise<readonly Readonly<{ kind: string, fingerprint: string, details: Readonly<Record<string, unknown>> }>[]>}
   */
  async openAlerts(network) {
    const rows = await this.#db.rows("SELECT kind, fingerprint, details FROM chain_alerts WHERE network = $1 AND resolved_at IS NULL ORDER BY id", [network]);
    return Object.freeze(rows.map((row) => Object.freeze({ kind: row.kind, fingerprint: row.fingerprint, details: row.details })));
  }

  /**
   * Where a game's records are: the index a verifier may use to find them on chain.
   * @param {string} gameId
   * @returns {Promise<readonly Readonly<{ seq: number, status: string, network: string, txId: string | null, blockNum: number | null }>[]>}
   */
  async gameIndex(gameId) {
    const rows = await this.#db.rows(
      `SELECT e.record_seq, e.status, e.network, t.tx_id, t.block_num
         FROM blockchain_events e LEFT JOIN blockchain_transactions t ON t.id = e.transaction_id
        WHERE e.game_id = $1 ORDER BY e.record_seq`,
      [gameId],
    );
    return Object.freeze(rows.map((row) => Object.freeze({ seq: row.record_seq, status: row.status, network: row.network, txId: row.tx_id, blockNum: row.block_num })));
  }
}
