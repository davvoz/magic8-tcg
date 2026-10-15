/** daily_runs and daily_games (migration 021). Days cross the boundary as "YYYY-MM-DD" text, never as dates. */
import { fromNullableTimestamp, fromTimestamp, toTimestamp } from "../../../platform/db/Database.js";

const RUN_COLUMNS = "user_id, day::text AS day, track, stage, game_id, attempts, reward_seed, reward_cards, rewarded_at, created_at";
const GAME_COLUMNS = "game_id, user_id, day::text AS day, stage, opponent, result, created_at, settled_at";

/**
 * @param {import("../../../platform/db/Database.js").Row} row
 * @returns {import("../application/ports.js").DailyRun}
 */
function toRun(row) {
  return Object.freeze({
    userId: row.user_id,
    day: row.day,
    track: row.track,
    stage: row.stage,
    gameId: row.game_id,
    attempts: row.attempts,
    rewardSeed: row.reward_seed === null ? null : row.reward_seed.trim(),
    rewardCards: row.reward_cards === null ? null : Object.freeze(row.reward_cards.map((card) => Object.freeze({ ...card }))),
    rewardedAt: fromNullableTimestamp(row.rewarded_at),
    createdAt: fromTimestamp(row.created_at),
  });
}

/**
 * @param {import("../../../platform/db/Database.js").Row} row
 * @returns {import("../application/ports.js").DailyGame}
 */
function toGame(row) {
  return Object.freeze({
    gameId: row.game_id,
    userId: row.user_id,
    day: row.day,
    stage: row.stage,
    opponent: row.opponent,
    result: row.result,
    createdAt: fromTimestamp(row.created_at),
    settledAt: fromNullableTimestamp(row.settled_at),
  });
}

/** @typedef {import("../application/ports.js").DailyRepository} DailyRepository */

/** @implements {DailyRepository} */
export class PgDailyRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  async findRun(userId, day) {
    const row = await this.#db.maybeOne(`SELECT ${RUN_COLUMNS} FROM daily_runs WHERE user_id = $1 AND day = $2::date`, [userId, day]);
    return row === null ? null : toRun(row);
  }

  async lockRun(userId, day) {
    const row = await this.#db.maybeOne(`SELECT ${RUN_COLUMNS} FROM daily_runs WHERE user_id = $1 AND day = $2::date FOR UPDATE`, [userId, day]);
    return row === null ? null : toRun(row);
  }

  async insertRun(run) {
    const row = await this.#db.maybeOne(
      "INSERT INTO daily_runs (user_id, day, track, stage, game_id, attempts, created_at) VALUES ($1, $2::date, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING user_id",
      [run.userId, run.day, run.track, run.stage, run.gameId, run.attempts, toTimestamp(run.createdAt)],
    );
    return row !== null;
  }

  async updateRun(userId, day, changes) {
    await this.#db.query(
      `UPDATE daily_runs
          SET stage = coalesce($3, stage),
              game_id = CASE WHEN $4::boolean THEN $5 ELSE game_id END,
              attempts = coalesce($6, attempts),
              reward_seed = coalesce($7, reward_seed),
              rewarded_at = coalesce($8, rewarded_at),
              reward_cards = coalesce($9::jsonb, reward_cards)
        WHERE user_id = $1 AND day = $2::date`,
      [
        userId,
        day,
        changes.stage ?? null,
        changes.gameId !== undefined,
        changes.gameId ?? null,
        changes.attempts ?? null,
        changes.rewardSeed ?? null,
        changes.rewardedAt === undefined ? null : toTimestamp(changes.rewardedAt),
        changes.rewardCards === undefined ? null : JSON.stringify(changes.rewardCards),
      ],
    );
  }

  async insertGame(game) {
    await this.#db.query("INSERT INTO daily_games (game_id, user_id, day, stage, opponent, created_at) VALUES ($1, $2, $3::date, $4, $5, $6)", [
      game.gameId,
      game.userId,
      game.day,
      game.stage,
      game.opponent,
      toTimestamp(game.createdAt),
    ]);
  }

  async settleGame(gameId, result, at) {
    const row = await this.#db.maybeOne(`UPDATE daily_games SET result = $2, settled_at = $3 WHERE game_id = $1 AND result IS NULL RETURNING ${GAME_COLUMNS}`, [gameId, result, toTimestamp(at)]);
    return row === null ? null : toGame(row);
  }

  async listGames(userId, day) {
    const rows = await this.#db.rows(`SELECT ${GAME_COLUMNS} FROM daily_games WHERE user_id = $1 AND day = $2::date ORDER BY created_at, game_id`, [userId, day]);
    return Object.freeze(rows.map(toGame));
  }
}
