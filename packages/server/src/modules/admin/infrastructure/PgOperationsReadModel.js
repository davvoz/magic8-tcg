/**
 * Read-only view across modules for operators: counts and ages that say
 * whether the server is healthy (outbox backlog, open orders, refunds,
 * games, alerts) and the audit log search. It never writes; every change
 * an operator makes goes through the module that owns the data.
 */
import { fromTimestamp } from "../../../platform/db/Database.js";

/** @param {readonly import("../../../platform/db/Database.js").Row[]} rows */
const countsBy = (rows, key) => Object.freeze(Object.fromEntries(rows.map((row) => [row[key], row.n])));

export class PgOperationsReadModel {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  async overview() {
    const outbox = await this.#db.rows("SELECT kind, status, count(*)::integer AS n, min(created_at) AS oldest FROM blockchain_events WHERE status <> 'IRREVERSIBLE' GROUP BY kind, status ORDER BY kind, status");
    const games = await this.#db.rows("SELECT status, count(*)::integer AS n FROM games WHERE status IN ('CREATED', 'ACTIVE') GROUP BY status");
    const orders = await this.#db.rows("SELECT status, count(*)::integer AS n FROM orders WHERE status IN ('CREATED', 'PAYMENT_PENDING', 'PAYMENT_DETECTED', 'PAYMENT_VERIFIED', 'FAILED') GROUP BY status");
    const refunds = await this.#db.rows("SELECT status, count(*)::integer AS n FROM refunds WHERE status IN ('PENDING', 'SENT') GROUP BY status");
    const alerts = await this.#db.maybeOne("SELECT count(*)::integer AS n FROM chain_alerts WHERE resolved_at IS NULL");
    const payments = await this.#db.maybeOne("SELECT count(*)::integer AS n, min(observed_at) AS oldest FROM payments WHERE status = 'DETECTED'");
    return Object.freeze({
      outbox: Object.freeze(outbox.map((row) => Object.freeze({ kind: row.kind, status: row.status, count: row.n, oldest: fromTimestamp(row.oldest) }))),
      games: countsBy(games, "status"),
      orders: countsBy(orders, "status"),
      refunds: countsBy(refunds, "status"),
      openAlerts: alerts?.n ?? 0,
      paymentsAwaitingConfirmation: Object.freeze({ count: payments?.n ?? 0, oldest: payments?.oldest ? fromTimestamp(payments.oldest) : null }),
    });
  }

  /**
   * @param {{ action?: string, targetId?: string, beforeSeq?: number, limit: number }} filter action matches as a prefix
   */
  async audit({ action, targetId, beforeSeq, limit }) {
    const rows = await this.#db.rows(
      `SELECT seq, at, actor_kind, actor_user_id, action, target_kind, target_id, ip, details FROM audit_logs
        WHERE ($1::text IS NULL OR left(action, length($1)) = $1)
          AND ($2::text IS NULL OR target_id = $2)
          AND ($3::bigint IS NULL OR seq < $3)
        ORDER BY seq DESC LIMIT $4`,
      [action ?? null, targetId ?? null, beforeSeq ?? null, limit],
    );
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({ seq: row.seq, at: fromTimestamp(row.at), actorKind: row.actor_kind, actorUserId: row.actor_user_id, action: row.action, targetKind: row.target_kind, targetId: row.target_id, ip: row.ip, details: row.details }),
      ),
    );
  }
}
