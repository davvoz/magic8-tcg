/**
 * products, product_prices, product_items, orders, order_items, rng_epochs.
 * Order state changes are compare-and-set on the current status
 * (docs/tcg/04-modello-dati.md §4).
 */
import { fromNullableTimestamp, fromTimestamp, toTimestamp } from "../../../platform/db/Database.js";
import { OPEN_STATUSES } from "../domain/Order.js";

/** Arbitrary namespace for the advisory lock serialising epoch rollover. */
const EPOCH_LOCK_KEY = 7_310_431;

/**
 * @param {import("../../../platform/db/Database.js").Row} row
 * @param {readonly import("../../../platform/db/Database.js").Row[]} items
 * @returns {import("../domain/Order.js").Order}
 */
function toOrder(row, items) {
  return Object.freeze({
    id: row.id,
    userId: row.user_id,
    status: row.status,
    network: row.network,
    asset: row.asset,
    totalAmount: row.total_amount,
    receiver: row.receiver,
    payer: row.payer,
    memo: row.memo,
    expiresAt: fromTimestamp(row.expires_at),
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    paymentId: row.payment_id,
    rngEpochId: row.rng_epoch_id,
    failureReason: row.failure_reason,
    version: row.version,
    createdAt: fromTimestamp(row.created_at),
    updatedAt: fromTimestamp(row.updated_at),
    items: Object.freeze(items.map((item) => Object.freeze({ position: item.position, productId: item.product_id, quantity: item.quantity, unitAmount: item.unit_amount }))),
  });
}

/**
 * @param {import("../../../platform/db/Database.js").Row} row
 * @returns {import("../application/ports.js").StoredEpoch}
 */
function toEpoch(row) {
  return Object.freeze({
    id: row.id,
    commit: row.commit,
    sealedSecret: new Uint8Array(row.secret_encrypted),
    openedAt: fromTimestamp(row.opened_at),
    closedAt: fromNullableTimestamp(row.closed_at),
    revealedAt: fromNullableTimestamp(row.revealed_at),
  });
}

/** @typedef {import("../application/ports.js").MarketplaceRepository} MarketplaceRepository */

/** @implements {MarketplaceRepository} */
export class PgMarketplaceRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  async syncProducts(products, at) {
    const ids = products.map((product) => product.id);
    const prices = products.flatMap((product) => [...product.prices].map(([asset, amount]) => ({ id: product.id, asset, amount })));
    const items = products.flatMap((product) => product.contents.map((content, position) => ({ id: product.id, position, ...content })));
    // One statement per table, whatever the number of products (the price list makes one per card).
    await this.#db.transaction(async () => {
      await this.#db.query("UPDATE products SET active = false, updated_at = $2 WHERE active AND NOT (id = ANY($1::text[]))", [ids, toTimestamp(at)]);
      await this.#db.query(
        `INSERT INTO products (id, kind, name, description, active, limits, updated_at)
         SELECT id, kind, name, description, active, limits::jsonb, $7::timestamptz
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::boolean[], $6::text[]) AS p (id, kind, name, description, active, limits)
         ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, name = EXCLUDED.name, description = EXCLUDED.description, active = EXCLUDED.active, limits = EXCLUDED.limits, updated_at = EXCLUDED.updated_at`,
        [ids, products.map((product) => product.kind), products.map((product) => product.name), products.map((product) => product.description), products.map((product) => product.active), products.map((product) => JSON.stringify(product.limits)), toTimestamp(at)],
      );
      await this.#db.query("DELETE FROM product_prices WHERE product_id = ANY($1::text[])", [ids]);
      await this.#db.query("INSERT INTO product_prices (product_id, asset, amount) SELECT * FROM unnest($1::text[], $2::text[], $3::bigint[])", [prices.map((price) => price.id), prices.map((price) => price.asset), prices.map((price) => price.amount)]);
      await this.#db.query("DELETE FROM product_items WHERE product_id = ANY($1::text[])", [ids]);
      await this.#db.query("INSERT INTO product_items (product_id, position, item_type, ref, count) SELECT * FROM unnest($1::text[], $2::integer[], $3::text[], $4::text[], $5::integer[])", [
        items.map((item) => item.id),
        items.map((item) => item.position),
        items.map((item) => item.type),
        items.map((item) => item.ref),
        items.map((item) => item.count),
      ]);
    });
  }

  async insertOrder(order) {
    const inserted = await this.#db.maybeOne(
      `INSERT INTO orders (id, user_id, status, network, asset, total_amount, receiver, payer, memo, expires_at, idempotency_key, request_hash,
                           payment_id, rng_epoch_id, failure_reason, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [
        order.id,
        order.userId,
        order.status,
        order.network,
        order.asset,
        order.totalAmount,
        order.receiver,
        order.payer,
        order.memo,
        toTimestamp(order.expiresAt),
        order.idempotencyKey,
        order.requestHash,
        order.paymentId,
        order.rngEpochId,
        order.failureReason,
        order.version,
        toTimestamp(order.createdAt),
        toTimestamp(order.updatedAt),
      ],
    );
    if (inserted === null) {
      return false;
    }
    for (const item of order.items) {
      await this.#db.query("INSERT INTO order_items (order_id, position, product_id, quantity, unit_amount) VALUES ($1, $2, $3, $4, $5)", [order.id, item.position, item.productId, item.quantity, item.unitAmount]);
    }
    return true;
  }

  findOrder(id) {
    return this.#one("SELECT * FROM orders WHERE id = $1", [id]);
  }

  findByIdempotencyKey(userId, key) {
    return this.#one("SELECT * FROM orders WHERE user_id = $1 AND idempotency_key = $2", [userId, key]);
  }

  findByMemo(memo) {
    return this.#one("SELECT * FROM orders WHERE memo = $1", [memo]);
  }

  async listForUser(userId, limit) {
    const { rows } = await this.#db.query("SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT $2", [userId, limit]);
    return this.#withItems(rows);
  }

  async countOpen(userId) {
    const row = await this.#db.maybeOne("SELECT count(*)::integer AS open FROM orders WHERE user_id = $1 AND status = ANY($2::text[])", [userId, OPEN_STATUSES]);
    return /** @type {import("../../../platform/db/Database.js").Row} */ (row).open;
  }

  /**
   * @param {string} id
   * @param {string} from
   * @param {string} to
   * @param {{ at: number, paymentId?: string | null, failureReason?: string | null }} changes
   */
  async transition(id, from, to, { at, paymentId, failureReason }) {
    const row = await this.#db.maybeOne(
      `UPDATE orders
          SET status = $3, version = version + 1, updated_at = $4,
              payment_id = CASE WHEN $5::boolean THEN $6::uuid ELSE payment_id END,
              failure_reason = CASE WHEN $7::boolean THEN $8 ELSE failure_reason END
        WHERE id = $1 AND status = $2
       RETURNING *`,
      [id, from, to, toTimestamp(at), paymentId !== undefined, paymentId ?? null, failureReason !== undefined, failureReason ?? null],
    );
    return row === null ? null : (await this.#withItems([row]))[0];
  }

  async listExpirable(before, limit) {
    const { rows } = await this.#db.query("SELECT id FROM orders WHERE status IN ('CREATED', 'PAYMENT_PENDING') AND expires_at < $1 ORDER BY expires_at LIMIT $2", [toTimestamp(before), limit]);
    return Object.freeze(rows.map((row) => row.id));
  }

  async listByStatus(status, limit) {
    const { rows } = await this.#db.query("SELECT id FROM orders WHERE status = $1 ORDER BY updated_at, id LIMIT $2", [status, limit]);
    return Object.freeze(rows.map((row) => row.id));
  }

  async lockEpochs() {
    await this.#db.query("SELECT pg_advisory_xact_lock($1)", [EPOCH_LOCK_KEY]);
  }

  async openEpoch() {
    const row = await this.#db.maybeOne("SELECT * FROM rng_epochs WHERE opened_at IS NOT NULL AND closed_at IS NULL");
    return row === null ? null : toEpoch(row);
  }

  async nextEpochId() {
    const row = await this.#db.maybeOne("SELECT coalesce(max(id), 0) + 1 AS next FROM rng_epochs");
    return /** @type {import("../../../platform/db/Database.js").Row} */ (row).next;
  }

  async insertEpoch({ id, commit, sealedSecret, openedAt }) {
    await this.#db.query("INSERT INTO rng_epochs (id, secret_encrypted, commit, opened_at) VALUES ($1, $2, $3, $4)", [id, Buffer.from(sealedSecret), commit, toTimestamp(openedAt)]);
  }

  async findEpoch(id) {
    const row = await this.#db.maybeOne("SELECT * FROM rng_epochs WHERE id = $1", [id]);
    return row === null ? null : toEpoch(row);
  }

  async closeEpoch(id, at) {
    await this.#db.query("UPDATE rng_epochs SET closed_at = $2 WHERE id = $1 AND closed_at IS NULL", [id, toTimestamp(at)]);
  }

  async markEpochRevealed(id, at) {
    const row = await this.#db.maybeOne("UPDATE rng_epochs SET revealed_at = $2 WHERE id = $1 AND closed_at IS NOT NULL AND revealed_at IS NULL RETURNING id", [id, toTimestamp(at)]);
    return row !== null;
  }

  async listEpochs() {
    const { rows } = await this.#db.query("SELECT * FROM rng_epochs ORDER BY id DESC LIMIT 100");
    return Object.freeze(rows.map(toEpoch));
  }

  async listUnrevealedClosed(limit) {
    const { rows } = await this.#db.query("SELECT * FROM rng_epochs WHERE closed_at IS NOT NULL AND revealed_at IS NULL ORDER BY id LIMIT $1", [limit]);
    return Object.freeze(rows.map(toEpoch));
  }

  async countOpenForEpoch(epochId) {
    const row = await this.#db.maybeOne("SELECT count(*)::integer AS open FROM orders WHERE rng_epoch_id = $1 AND status = ANY($2::text[])", [epochId, OPEN_STATUSES]);
    return /** @type {import("../../../platform/db/Database.js").Row} */ (row).open;
  }

  /**
   * @param {string} text
   * @param {readonly unknown[]} params
   */
  async #one(text, params) {
    const row = await this.#db.maybeOne(text, params);
    return row === null ? null : (await this.#withItems([row]))[0];
  }

  /** @param {readonly import("../../../platform/db/Database.js").Row[]} rows */
  async #withItems(rows) {
    if (rows.length === 0) {
      return Object.freeze([]);
    }
    const { rows: items } = await this.#db.query("SELECT * FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY order_id, position", [rows.map((row) => row.id)]);
    return Object.freeze(rows.map((row) => toOrder(row, items.filter((item) => item.order_id === row.id))));
  }
}
