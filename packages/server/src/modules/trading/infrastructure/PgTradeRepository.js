/**
 * trades and trade_items (docs/tcg/13-scambi.md). A trade leaves OPEN with a
 * compare-and-set on its status, under the row lock taken by `lock`.
 */
import { fromTimestamp, toTimestamp } from "../../../platform/db/Database.js";

/** @param {import("../../../platform/db/Database.js").Row} row @returns {import("../domain/Trade.js").Trade} */
function toTrade(row) {
  return Object.freeze({
    id: row.id,
    proposerId: row.proposer_id,
    counterpartyId: row.counterparty_id,
    status: row.status,
    wants: Object.freeze(row.wants.map((/** @type {any} */ want) => Object.freeze({ definitionId: want.definitionId, count: want.count }))),
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    createdAt: fromTimestamp(row.created_at),
    expiresAt: fromTimestamp(row.expires_at),
    closedAt: row.closed_at === null ? null : fromTimestamp(row.closed_at),
  });
}

export class PgTradeRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  /**
   * @param {import("../domain/Trade.js").Trade} trade
   * @returns {Promise<boolean>} false when the proposer already used that idempotency key (nothing is written)
   */
  async insert(trade) {
    const rows = await this.#db.rows(
      `INSERT INTO trades (id, proposer_id, counterparty_id, status, wants, idempotency_key, request_hash, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (proposer_id, idempotency_key) DO NOTHING RETURNING id`,
      [trade.id, trade.proposerId, trade.counterpartyId, trade.status, JSON.stringify(trade.wants), trade.idempotencyKey, trade.requestHash, toTimestamp(trade.createdAt), toTimestamp(trade.expiresAt)],
    );
    return rows.length === 1;
  }

  /**
   * @param {string} proposerId
   * @param {string} key
   */
  async findByIdempotencyKey(proposerId, key) {
    const row = await this.#db.maybeOne("SELECT * FROM trades WHERE proposer_id = $1 AND idempotency_key = $2", [proposerId, key]);
    return row === null ? null : toTrade(row);
  }

  /** @param {string} id */
  async lock(id) {
    const row = await this.#db.maybeOne("SELECT * FROM trades WHERE id = $1 FOR UPDATE", [id]);
    return row === null ? null : toTrade(row);
  }

  /**
   * OPEN → `status`; false when the trade was no longer open.
   * @param {string} id
   * @param {string} status
   * @param {number} at
   */
  async close(id, status, at) {
    const rows = await this.#db.rows("UPDATE trades SET status = $2, closed_at = $3 WHERE id = $1 AND status = 'OPEN' RETURNING id", [id, status, toTimestamp(at)]);
    return rows.length === 1;
  }

  /**
   * @param {string} tradeId
   * @param {"give" | "take"} side
   * @param {readonly string[]} instanceIds
   */
  async insertItems(tradeId, side, instanceIds) {
    await this.#db.query("INSERT INTO trade_items (trade_id, card_instance_id, side) SELECT $1, id, $2 FROM unnest($3::uuid[]) AS id", [tradeId, side, instanceIds]);
  }

  /**
   * @param {string} tradeId
   * @param {"give" | "take"} side
   * @returns {Promise<readonly string[]>}
   */
  async itemIds(tradeId, side) {
    const rows = await this.#db.rows("SELECT card_instance_id FROM trade_items WHERE trade_id = $1 AND side = $2 ORDER BY card_instance_id", [tradeId, side]);
    return Object.freeze(rows.map((row) => row.card_instance_id));
  }

  /**
   * The accounts of both players.
   * @param {string} tradeId
   */
  async accountsOf(tradeId) {
    const row = await this.#db.maybeOne(
      "SELECT p.account AS proposer, c.account AS counterparty FROM trades t JOIN users p ON p.id = t.proposer_id JOIN users c ON c.id = t.counterparty_id WHERE t.id = $1",
      [tradeId],
    );
    if (row === null) {
      throw new Error(`trade ${tradeId} does not exist`);
    }
    return Object.freeze({ proposer: row.proposer, counterparty: row.counterparty });
  }

  /** @param {string} proposerId */
  async countOpen(proposerId) {
    const row = await this.#db.maybeOne("SELECT count(*)::integer AS open FROM trades WHERE proposer_id = $1 AND status = 'OPEN'", [proposerId]);
    return row?.open ?? 0;
  }

  /**
   * A user's trades, newest first, with both accounts and every copy.
   * @param {string} userId
   * @param {number} limit
   */
  async listFor(userId, limit) {
    const trades = await this.#db.rows(
      `SELECT t.*, p.account AS proposer_account, c.account AS counterparty_account
         FROM trades t JOIN users p ON p.id = t.proposer_id JOIN users c ON c.id = t.counterparty_id
        WHERE t.proposer_id = $1 OR t.counterparty_id = $1
        ORDER BY t.created_at DESC LIMIT $2`,
      [userId, limit],
    );
    const items = await this.#db.rows(
      `SELECT i.trade_id, i.side, ci.id, ci.definition_id, ci.serial, ci.finish
         FROM trade_items i JOIN card_instances ci ON ci.id = i.card_instance_id
        WHERE i.trade_id = ANY($1::uuid[])
        ORDER BY ci.definition_id, ci.serial`,
      [trades.map((row) => row.id)],
    );
    return Object.freeze(
      trades.map((row) =>
        Object.freeze({
          trade: toTrade(row),
          proposerAccount: row.proposer_account,
          counterpartyAccount: row.counterparty_account,
          items: Object.freeze(items.filter((item) => item.trade_id === row.id).map((item) => Object.freeze({ side: item.side, id: item.id, definitionId: item.definition_id, serial: item.serial, finish: item.finish }))),
        }),
      ),
    );
  }

  /**
   * @param {number} now
   * @param {number} limit
   * @returns {Promise<readonly string[]>}
   */
  async listExpired(now, limit) {
    const rows = await this.#db.rows("SELECT id FROM trades WHERE status = 'OPEN' AND expires_at <= $1 ORDER BY expires_at LIMIT $2", [toTimestamp(now), limit]);
    return Object.freeze(rows.map((row) => row.id));
  }
}
