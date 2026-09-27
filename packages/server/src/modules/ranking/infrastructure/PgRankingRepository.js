/** ratings, rating_changes (append-only), ranking_flags. */
import { fromTimestamp, toTimestamp } from "../../../platform/db/Database.js";

/**
 * @typedef {Readonly<{ season: string, userId: string, account: string, rating: number, rd: number, volatility: number, games: number, wins: number, losses: number, draws: number }>} StoredRating
 */

/** @param {import("../../../platform/db/Database.js").Row} row @returns {StoredRating} */
const toRating = (row) =>
  Object.freeze({ season: row.season, userId: row.user_id, account: row.account, rating: row.rating, rd: row.rd, volatility: row.volatility, games: row.games, wins: row.wins, losses: row.losses, draws: row.draws });

export class PgRankingRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  /**
   * @param {string} season
   * @param {string} userId
   * @returns {Promise<StoredRating | null>}
   */
  async find(season, userId) {
    const row = await this.#db.maybeOne("SELECT * FROM ratings WHERE season = $1 AND user_id = $2", [season, userId]);
    return row === null ? null : toRating(row);
  }

  /**
   * Creates the row with the starting rating if missing, then locks it until the unit of work ends.
   * @param {{ season: string, userId: string, account: string, rating: number, rd: number, volatility: number, at: number }} initial
   * @returns {Promise<StoredRating>}
   */
  async lock({ season, userId, account, rating, rd, volatility, at }) {
    await this.#db.query("INSERT INTO ratings (season, user_id, account, rating, rd, volatility, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING", [
      season,
      userId,
      account,
      rating,
      rd,
      volatility,
      toTimestamp(at),
    ]);
    return toRating(/** @type {any} */ (await this.#db.maybeOne("SELECT * FROM ratings WHERE season = $1 AND user_id = $2 FOR UPDATE", [season, userId])));
  }

  /** @param {string} gameId */
  async recorded(gameId) {
    return (await this.#db.maybeOne("SELECT 1 AS found FROM rating_changes WHERE game_id = $1 LIMIT 1", [gameId])) !== null;
  }

  /**
   * Rated (counted) games between two players since a time.
   * @param {string} userId
   * @param {string} opponentId
   * @param {number} since
   */
  async countCounted(userId, opponentId, since) {
    const row = await this.#db.maybeOne("SELECT count(*)::integer AS n FROM rating_changes WHERE user_id = $1 AND opponent_id = $2 AND counted AND finished_at >= $3", [userId, opponentId, toTimestamp(since)]);
    return row?.n ?? 0;
  }

  /**
   * Games between two players that ended by a concession at or before `turn`, since a time.
   * @param {{ userId: string, opponentId: string, since: number, turn: number }} query
   */
  async countEarlyConcedes({ userId, opponentId, since, turn }) {
    const row = await this.#db.maybeOne(
      "SELECT count(*)::integer AS n FROM rating_changes WHERE user_id = $1 AND opponent_id = $2 AND end_reason = 'concede' AND end_turn <= $4 AND finished_at >= $3",
      [userId, opponentId, toTimestamp(since), turn],
    );
    return row?.n ?? 0;
  }

  /**
   * @param {{ gameId: string, userId: string, season: string, opponentId: string, score: number, counted: boolean, reason: string | null, before: { rating: number, rd: number }, after: { rating: number, rd: number }, endReason: string, endTurn: number, finishedAt: number }} change
   */
  async insertChange({ gameId, userId, season, opponentId, score, counted, reason, before, after, endReason, endTurn, finishedAt }) {
    await this.#db.query(
      `INSERT INTO rating_changes (game_id, user_id, season, opponent_id, score, counted, reason, rating_before, rating_after, rd_before, rd_after, end_reason, end_turn, finished_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [gameId, userId, season, opponentId, score, counted, reason, before.rating, after.rating, before.rd, after.rd, endReason, endTurn, toTimestamp(finishedAt)],
    );
  }

  /**
   * @param {{ season: string, userId: string, rating: number, rd: number, volatility: number, score: number, at: number }} update
   */
  async applyResult({ season, userId, rating, rd, volatility, score, at }) {
    await this.#db.query(
      `UPDATE ratings SET rating = $3, rd = $4, volatility = $5, games = games + 1,
              wins = wins + ($6 = 1)::integer, losses = losses + ($6 = 0)::integer, draws = draws + ($6 = 0.5)::integer, updated_at = $7
        WHERE season = $1 AND user_id = $2`,
      [season, userId, rating, rd, volatility, score, toTimestamp(at)],
    );
  }

  /**
   * @param {{ season: string, kind: string, userA: string, userB: string, details: Readonly<Record<string, unknown>>, fingerprint: string, at: number }} flag
   * @returns {Promise<boolean>} false when already flagged
   */
  async insertFlag({ season, kind, userA, userB, details, fingerprint, at }) {
    const row = await this.#db.maybeOne(
      "INSERT INTO ranking_flags (season, kind, user_a, user_b, details, fingerprint, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (fingerprint) DO NOTHING RETURNING id",
      [season, kind, userA, userB, JSON.stringify(details), fingerprint, toTimestamp(at)],
    );
    return row !== null;
  }

  /**
   * The best ratings of a season: settled ones (rd <= maxRd) first, then provisional ones.
   * @param {{ season: string, maxRd: number, limit: number }} query
   */
  async leaderboard({ season, maxRd, limit }) {
    const rows = await this.#db.rows("SELECT * FROM ratings WHERE season = $1 ORDER BY rd > $2, rating DESC, games DESC, user_id LIMIT $3", [season, maxRd, limit]);
    return Object.freeze(rows.map(toRating));
  }

  /**
   * How many settled ratings of the season are above `rating`.
   * @param {{ season: string, maxRd: number, rating: number }} query
   */
  async countAbove({ season, maxRd, rating }) {
    const row = await this.#db.maybeOne("SELECT count(*)::integer AS n FROM ratings WHERE season = $1 AND rd <= $2 AND rating > $3", [season, maxRd, rating]);
    return row?.n ?? 0;
  }

  /** @param {number} limit */
  async openFlags(limit) {
    const rows = await this.#db.rows("SELECT * FROM ranking_flags WHERE resolved_at IS NULL ORDER BY id DESC LIMIT $1", [limit]);
    return Object.freeze(rows.map((row) => Object.freeze({ id: row.id, season: row.season, kind: row.kind, userA: row.user_a, userB: row.user_b, details: row.details, createdAt: fromTimestamp(row.created_at) })));
  }
}
