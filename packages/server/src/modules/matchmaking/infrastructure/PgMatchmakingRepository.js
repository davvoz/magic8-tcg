/** matchmaking: queue tickets. One WAITING ticket per user (unique partial index). */
import { fromTimestamp, toTimestamp } from "../../../platform/db/Database.js";

/**
 * @param {import("../../../platform/db/Database.js").Row} row
 */
function toTicket(row) {
  return Object.freeze({
    id: row.id,
    userId: row.user_id,
    account: row.account,
    mode: row.mode,
    deckId: row.deck_id,
    deck: row.deck_snapshot,
    rating: row.rating,
    status: row.status,
    createdAt: fromTimestamp(row.created_at),
  });
}

export class PgMatchmakingRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  /**
   * @param {{ id: string, userId: string, account: string, mode: string, deckId: string, deck: readonly (readonly [string, number])[], rating: number, at: number }} ticket
   */
  async insertTicket({ id, userId, account, mode, deckId, deck, rating, at }) {
    await this.#db.query("INSERT INTO matchmaking (id, user_id, account, mode, deck_id, deck_snapshot, rating, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'WAITING', $8, $8)", [
      id,
      userId,
      account,
      mode,
      deckId,
      JSON.stringify(deck),
      rating,
      toTimestamp(at),
    ]);
  }

  /**
   * @param {string} userId
   * @param {number} at
   * @returns {Promise<number>} tickets cancelled
   */
  async cancelWaiting(userId, at) {
    const result = await this.#db.query("UPDATE matchmaking SET status = 'CANCELLED', updated_at = $2 WHERE user_id = $1 AND status = 'WAITING'", [userId, toTimestamp(at)]);
    return result.rowCount;
  }

  /**
   * @param {number} at
   * @returns {Promise<string[]>} the users whose ticket was cancelled
   */
  async cancelAllWaiting(at) {
    const rows = await this.#db.rows("UPDATE matchmaking SET status = 'CANCELLED', updated_at = $1 WHERE status = 'WAITING' RETURNING user_id", [toTimestamp(at)]);
    return rows.map((row) => row.user_id);
  }

  /** @returns {Promise<string[]>} the users with a waiting ticket */
  async waitingUsers() {
    const rows = await this.#db.rows("SELECT user_id FROM matchmaking WHERE status = 'WAITING'");
    return rows.map((row) => row.user_id);
  }

  /** @param {string} userId */
  async findWaiting(userId) {
    const row = await this.#db.maybeOne("SELECT * FROM matchmaking WHERE user_id = $1 AND status = 'WAITING'", [userId]);
    return row === null ? null : toTicket(row);
  }

  /**
   * The two oldest waiting tickets of a mode, locked; tickets another transaction holds are skipped.
   * @param {string} mode
   */
  async lockOldestPair(mode) {
    const rows = await this.#db.rows("SELECT * FROM matchmaking WHERE status = 'WAITING' AND mode = $1 ORDER BY created_at, id LIMIT 2 FOR UPDATE SKIP LOCKED", [mode]);
    return Object.freeze(rows.map(toTicket));
  }

  /**
   * @param {readonly string[]} ids
   * @param {string} gameId
   * @param {number} at
   */
  async markMatched(ids, gameId, at) {
    const result = await this.#db.query("UPDATE matchmaking SET status = 'MATCHED', game_id = $2, updated_at = $3 WHERE id = ANY($1::uuid[]) AND status = 'WAITING'", [ids, gameId, toTimestamp(at)]);
    if (result.rowCount !== ids.length) {
      throw new Error("matchmaking: a locked ticket was not waiting any more");
    }
  }

  /**
   * @param {number} before
   * @param {number} at
   */
  async expireOlderThan(before, at) {
    const result = await this.#db.query("UPDATE matchmaking SET status = 'EXPIRED', updated_at = $2 WHERE status = 'WAITING' AND created_at < $1", [toTimestamp(before), toTimestamp(at)]);
    return result.rowCount;
  }
}
