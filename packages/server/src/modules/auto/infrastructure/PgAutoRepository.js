/** auto_tickets: one WAITING ticket per user (unique partial index). */
import { fromNullableTimestamp, fromTimestamp, toTimestamp } from "../../../platform/db/Database.js";

/**
 * @typedef {Readonly<{
 *   id: string, userId: string, account: string, status: string, sealedSecret: Uint8Array, commit: string, season: string | null,
 *   style: string | null, deckId: string | null, deck: readonly (readonly [string, number])[] | null, entropy: string | null, entries: number,
 *   gameId: string | null, seat: string | null, aiVersion: number | null, preparedAt: number, joinedAt: number | null, closedAt: number | null,
 * }>} StoredTicket
 */

/**
 * @param {import("../../../platform/db/Database.js").Row} row
 * @returns {StoredTicket}
 */
function toTicket(row) {
  return Object.freeze({
    id: row.id,
    userId: row.user_id,
    account: row.account,
    status: row.status,
    sealedSecret: new Uint8Array(row.secret_encrypted),
    commit: row.secret_commit,
    season: row.season,
    style: row.style,
    deckId: row.deck_id,
    deck: row.deck_snapshot,
    entropy: row.entropy,
    entries: row.entries,
    gameId: row.game_id,
    seat: row.seat,
    aiVersion: row.ai_version,
    preparedAt: fromTimestamp(row.prepared_at),
    joinedAt: fromNullableTimestamp(row.joined_at),
    closedAt: fromNullableTimestamp(row.closed_at),
  });
}

export class PgAutoRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  /**
   * @param {{ id: string, userId: string, account: string, sealedSecret: Uint8Array, commit: string, at: number }} ticket
   */
  async insertPrepared({ id, userId, account, sealedSecret, commit, at }) {
    await this.#db.query("INSERT INTO auto_tickets (id, user_id, account, status, secret_encrypted, secret_commit, prepared_at) VALUES ($1, $2, $3, 'PREPARED', $4, $5, $6)", [
      id,
      userId,
      account,
      Buffer.from(sealedSecret),
      commit,
      toTimestamp(at),
    ]);
  }

  /**
   * Tickets a user prepared since a time (a bound on how many they may prepare).
   * @param {string} userId
   * @param {number} since
   */
  async countPrepared(userId, since) {
    const row = await this.#db.maybeOne("SELECT count(*)::integer AS n FROM auto_tickets WHERE user_id = $1 AND prepared_at > $2", [userId, toTimestamp(since)]);
    return row?.n ?? 0;
  }

  /**
   * A user's prepared ticket, locked until the unit of work ends.
   * @param {string} id
   * @param {string} userId
   */
  async lockPrepared(id, userId) {
    const row = await this.#db.maybeOne("SELECT * FROM auto_tickets WHERE id = $1 AND user_id = $2 AND status = 'PREPARED' FOR UPDATE", [id, userId]);
    return row === null ? null : toTicket(row);
  }

  /**
   * @param {{ id: string, season: string, style: string, deckId: string, deck: readonly (readonly [string, number])[], entropy: string, entries: number, at: number }} joined
   */
  async markWaiting({ id, season, style, deckId, deck, entropy, entries, at }) {
    await this.#db.query(
      `UPDATE auto_tickets SET status = 'WAITING', season = $2, style = $3, deck_id = $4, deck_snapshot = $5, entropy = $6, entries = $7, joined_at = $8
        WHERE id = $1 AND status = 'PREPARED'`,
      [id, season, style, deckId, JSON.stringify(deck), entropy, entries, toTimestamp(at)],
    );
  }

  /** @param {string} userId */
  async findWaiting(userId) {
    const row = await this.#db.maybeOne("SELECT * FROM auto_tickets WHERE user_id = $1 AND status = 'WAITING'", [userId]);
    return row === null ? null : toTicket(row);
  }

  /** How many tickets wait in the list. */
  async countWaiting() {
    const row = await this.#db.maybeOne("SELECT count(*)::integer AS n FROM auto_tickets WHERE status = 'WAITING'");
    return row?.n ?? 0;
  }

  /**
   * The oldest waiting tickets of a season, oldest first, locked; tickets another transaction holds are skipped.
   * @param {string} season
   * @param {number} limit
   */
  async lockOldest(season, limit) {
    const rows = await this.#db.rows("SELECT * FROM auto_tickets WHERE status = 'WAITING' AND season = $1 ORDER BY joined_at, id LIMIT $2 FOR UPDATE SKIP LOCKED", [season, limit]);
    return Object.freeze(rows.map(toTicket));
  }

  /**
   * @param {{ id: string, gameId: string, seat: string, aiVersion: number, at: number }} matched
   */
  async markMatched({ id, gameId, seat, aiVersion, at }) {
    const result = await this.#db.query("UPDATE auto_tickets SET status = 'MATCHED', game_id = $2, seat = $3, ai_version = $4, closed_at = $5 WHERE id = $1 AND status = 'WAITING'", [
      id,
      gameId,
      seat,
      aiVersion,
      toTimestamp(at),
    ]);
    if (result.rowCount !== 1) {
      throw new Error("auto list: a locked ticket was not waiting any more");
    }
  }

  /**
   * The waiting tickets of other seasons than `season` (all of them when null): their season is over.
   * @param {string | null} season
   */
  async listWaitingOutside(season) {
    const rows = await this.#db.rows("SELECT * FROM auto_tickets WHERE status = 'WAITING' AND ($1::text IS NULL OR season <> $1) ORDER BY joined_at, id", [season]);
    return Object.freeze(rows.map(toTicket));
  }

  /**
   * Closes a waiting ticket that never became a game.
   * @param {string} id
   * @param {"REFUNDED" | "FAILED"} status
   * @param {number} at
   * @returns {Promise<boolean>} false when it was not waiting any more
   */
  async close(id, status, at) {
    const result = await this.#db.query("UPDATE auto_tickets SET status = $2, closed_at = $3 WHERE id = $1 AND status = 'WAITING'", [id, status, toTimestamp(at)]);
    return result.rowCount === 1;
  }

  /** @param {string} gameId */
  async ticketsOfGame(gameId) {
    const rows = await this.#db.rows("SELECT * FROM auto_tickets WHERE game_id = $1 ORDER BY seat", [gameId]);
    return Object.freeze(rows.map(toTicket));
  }

  /**
   * Forgets tickets prepared and never joined.
   * @param {number} before
   * @returns {Promise<number>}
   */
  async deletePreparedBefore(before) {
    const result = await this.#db.query("DELETE FROM auto_tickets WHERE status = 'PREPARED' AND prepared_at < $1", [toTimestamp(before)]);
    return result.rowCount;
  }
}
