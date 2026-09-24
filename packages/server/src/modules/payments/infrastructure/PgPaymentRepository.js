/**
 * payments, refunds, chain_cursors. A transfer is inserted once
 * (UNIQUE (network, tx_id, op_index)); state changes are compare-and-set.
 */
import { fromNullableTimestamp, fromTimestamp, toTimestamp } from "../../../platform/db/Database.js";

/**
 * @param {import("../../../platform/db/Database.js").Row} row
 * @returns {import("../domain/Payment.js").Payment}
 */
function toPayment(row) {
  return Object.freeze({
    id: row.id,
    network: row.network,
    txId: row.tx_id,
    opIndex: row.op_index,
    blockNum: row.block_num,
    time: fromTimestamp(row.block_time),
    from: row.from_account,
    to: row.to_account,
    asset: row.asset,
    amount: row.amount,
    memo: row.memo,
    orderId: row.order_id,
    status: row.status,
    problem: row.problem,
    observedAt: fromTimestamp(row.observed_at),
    irreversibleAt: fromNullableTimestamp(row.irreversible_at),
  });
}

/** @implements {import("../application/ports.js").PaymentRepository} */
export class PgPaymentRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  async insert(payment) {
    const row = await this.#db.maybeOne(
      `INSERT INTO payments (id, network, tx_id, op_index, block_num, block_time, from_account, to_account, asset, amount, memo, order_id, status, problem, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (network, tx_id, op_index) DO NOTHING
       RETURNING id`,
      [
        payment.id,
        payment.network,
        payment.txId,
        payment.opIndex,
        payment.blockNum,
        toTimestamp(payment.time),
        payment.from,
        payment.to,
        payment.asset,
        payment.amount,
        payment.memo,
        payment.orderId,
        payment.status,
        payment.problem,
        toTimestamp(payment.observedAt),
      ],
    );
    return row !== null;
  }

  async findByTransfer(network, txId, opIndex) {
    const row = await this.#db.maybeOne("SELECT * FROM payments WHERE network = $1 AND tx_id = $2 AND op_index = $3", [network, txId, opIndex]);
    return row === null ? null : toPayment(row);
  }

  async find(id) {
    const row = await this.#db.maybeOne("SELECT * FROM payments WHERE id = $1", [id]);
    return row === null ? null : toPayment(row);
  }

  async listDetected(network, limit) {
    const { rows } = await this.#db.query("SELECT * FROM payments WHERE network = $1 AND status = 'DETECTED' ORDER BY block_num, tx_id, op_index LIMIT $2", [network, limit]);
    return Object.freeze(rows.map(toPayment));
  }

  async transition(id, from, to, { problem, orderId, blockNum, irreversibleAt } = {}) {
    const row = await this.#db.maybeOne(
      `UPDATE payments
          SET status = $3,
              problem = CASE WHEN $4::boolean THEN $5 ELSE problem END,
              order_id = CASE WHEN $6::boolean THEN $7::uuid ELSE order_id END,
              block_num = coalesce($8::bigint, block_num),
              irreversible_at = coalesce($9::timestamptz, irreversible_at)
        WHERE id = $1 AND status = $2
       RETURNING *`,
      [id, from, to, problem !== undefined, problem ?? null, orderId !== undefined, orderId ?? null, blockNum ?? null, irreversibleAt === undefined ? null : toTimestamp(irreversibleAt)],
    );
    return row === null ? null : toPayment(row);
  }

  async insertRefund({ id, paymentId, toAccount, asset, amount, at }) {
    await this.#db.query("INSERT INTO refunds (id, payment_id, to_account, asset, amount, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $6)", [id, paymentId, toAccount, asset, amount, toTimestamp(at)]);
  }

  async listPendingRefunds(limit) {
    const { rows } = await this.#db.query("SELECT * FROM refunds WHERE status = 'PENDING' ORDER BY created_at, id LIMIT $1", [limit]);
    return Object.freeze(rows.map((row) => Object.freeze({ id: row.id, paymentId: row.payment_id, toAccount: row.to_account, asset: row.asset, amount: row.amount, status: row.status, createdAt: fromTimestamp(row.created_at) })));
  }

  async getCursor(name) {
    const row = await this.#db.maybeOne("SELECT position FROM chain_cursors WHERE name = $1", [name]);
    return row === null ? null : Number(row.position.index);
  }

  async setCursor(name, network, position, at) {
    await this.#db.query(
      `INSERT INTO chain_cursors (name, network, position, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO UPDATE SET position = $3, updated_at = $4
       WHERE (chain_cursors.position->>'index')::bigint < ($3::jsonb->>'index')::bigint`,
      [name, network, JSON.stringify({ index: position }), toTimestamp(at)],
    );
  }
}
