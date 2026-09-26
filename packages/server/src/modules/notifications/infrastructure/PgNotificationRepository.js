/**
 * notifications (docs/tcg/15-notifiche.md). `insert` also sends the NOTIFY
 * that wakes the relays; inside a unit of work both wait for its commit.
 */
import { fromNullableTimestamp, fromTimestamp, toTimestamp } from "../../../platform/db/Database.js";

/** @param {import("../../../platform/db/Database.js").Row} row @returns {import("../domain/Notification.js").Notification} */
function toNotification(row) {
  return Object.freeze({ id: Number(row.id), userId: row.user_id, kind: row.kind, data: Object.freeze(row.data), createdAt: fromTimestamp(row.created_at), readAt: fromNullableTimestamp(row.read_at) });
}

export class PgNotificationRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  /**
   * @param {{ userId: string, kind: string, data: object, createdAt: number }} notification
   * @param {string} channel where to announce it
   * @returns {Promise<number>} its id
   */
  async insert({ userId, kind, data, createdAt }, channel) {
    const row = await this.#db.maybeOne("INSERT INTO notifications (user_id, kind, data, created_at) VALUES ($1, $2, $3, $4) RETURNING id", [userId, kind, JSON.stringify(data), toTimestamp(createdAt)]);
    const id = Number(/** @type {import("../../../platform/db/Database.js").Row} */ (row).id);
    await this.#db.query("SELECT pg_notify($1, $2)", [channel, JSON.stringify({ id, userId })]);
    return id;
  }

  /** @param {number} id */
  async find(id) {
    const row = await this.#db.maybeOne("SELECT * FROM notifications WHERE id = $1", [id]);
    return row === null ? null : toNotification(row);
  }

  /**
   * A player's notifications, newest first, older than `before` when given.
   * @param {string} userId
   * @param {{ before: number | null, limit: number }} page
   */
  async listFor(userId, { before, limit }) {
    const rows = await this.#db.rows("SELECT * FROM notifications WHERE user_id = $1 AND ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT $3", [userId, before, limit]);
    return rows.map(toNotification);
  }

  /** @param {string} userId */
  async unreadCount(userId) {
    const row = await this.#db.maybeOne("SELECT count(*)::integer AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL", [userId]);
    return /** @type {import("../../../platform/db/Database.js").Row} */ (row).n;
  }

  /**
   * @param {string} userId
   * @param {readonly number[] | null} ids null: every unread one
   * @param {number} at
   * @returns {Promise<number>} notifications marked
   */
  async markRead(userId, ids, at) {
    const result = await this.#db.query("UPDATE notifications SET read_at = $3 WHERE user_id = $1 AND read_at IS NULL AND ($2::bigint[] IS NULL OR id = ANY($2::bigint[]))", [userId, ids, toTimestamp(at)]);
    return result.rowCount;
  }

  /**
   * Retention: read notifications older than `readBefore`, any older than `anyBefore`.
   * @param {{ readBefore: number, anyBefore: number, limit: number }} policy
   * @returns {Promise<number>} rows deleted
   */
  async purge({ readBefore, anyBefore, limit }) {
    const result = await this.#db.query(
      `DELETE FROM notifications WHERE id IN (
         SELECT id FROM notifications WHERE created_at < $2 OR (read_at IS NOT NULL AND created_at < $1) ORDER BY id LIMIT $3)`,
      [toTimestamp(readBefore), toTimestamp(anyBefore), limit],
    );
    return result.rowCount;
  }
}
