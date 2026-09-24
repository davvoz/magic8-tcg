/** blockchain_events: the outbox of immutable protocol records. */
import { toTimestamp } from "../../../platform/db/Database.js";

export class PgOutboxRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  /**
   * @param {{ network: string, kind: string, orderId: string | null, payload: string, payloadHash: string, priority: number, at: number }} record
   */
  async insert({ network, kind, orderId, payload, payloadHash, priority, at }) {
    await this.#db.query("INSERT INTO blockchain_events (network, kind, order_id, payload, payload_hash, priority, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'BUILT', $7)", [
      network,
      kind,
      orderId,
      payload,
      payloadHash,
      priority,
      toTimestamp(at),
    ]);
  }

  /** @param {string} orderId */
  async listForOrder(orderId) {
    const rows = await this.#db.rows("SELECT payload, status FROM blockchain_events WHERE order_id = $1 AND kind = 'RECEIPT' ORDER BY id", [orderId]);
    return Object.freeze(rows.map((row) => Object.freeze({ payload: row.payload, status: row.status })));
  }
}
