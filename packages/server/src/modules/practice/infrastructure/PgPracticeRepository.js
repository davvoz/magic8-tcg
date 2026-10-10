/** practice_games (migration 020). */
import { toTimestamp } from "../../../platform/db/Database.js";

/**
 * @typedef {Readonly<{ seedHash: string, userId: string, result: "win" | "loss" | "draw", endReason: string, turns: number, moves: number }>} PracticeGame
 */

export class PgPracticeRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  /**
   * Records a game once (its seed's hash is the key).
   * @param {PracticeGame & { at: number }} game
   * @returns {Promise<boolean>} false when that game was already recorded
   */
  async insert({ seedHash, userId, result, endReason, turns, moves, at }) {
    const row = await this.#db.maybeOne(
      "INSERT INTO practice_games (seed_hash, user_id, result, end_reason, turns, moves, recorded_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING seed_hash",
      [seedHash, userId, result, endReason, turns, moves, toTimestamp(at)],
    );
    return row !== null;
  }

  /**
   * @param {string} userId
   * @returns {Promise<number>} the practice games the player has had counted
   */
  async countOf(userId) {
    const row = await this.#db.maybeOne("SELECT count(*)::integer AS n FROM practice_games WHERE user_id = $1", [userId]);
    return row?.n ?? 0;
  }
}
