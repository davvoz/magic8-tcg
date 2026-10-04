/** seasons: the calendar of ranked seasons. */
import { fromNullableTimestamp, fromTimestamp, toTimestamp } from "../../../platform/db/Database.js";

/** Arbitrary key of the advisory lock that serialises changes to the calendar. */
const CALENDAR_LOCK_KEY = 718_001;

/**
 * @typedef {import("../domain/RankedSettings.js").Season} Season
 */

/** @param {import("../../../platform/db/Database.js").Row} row @returns {Season} */
const toSeason = (row) =>
  Object.freeze({ id: row.id, name: row.name, startsAt: fromTimestamp(row.starts_at), endsAt: fromNullableTimestamp(row.ends_at), prizePool: row.prize_pool, entryFee: row.entry_fee });

/** @param {number | null} time */
const toNullableTimestamp = (time) => (time === null ? null : toTimestamp(time));

export class PgSeasonRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  /** Holds the calendar until the unit of work ends: changes to it happen one at a time. */
  async lock() {
    await this.#db.query("SELECT pg_advisory_xact_lock($1)", [CALENDAR_LOCK_KEY]);
  }

  /** @returns {Promise<readonly Season[]>} in the order they start */
  async all() {
    const rows = await this.#db.rows("SELECT id, name, starts_at, ends_at, prize_pool, entry_fee FROM seasons ORDER BY starts_at");
    return Object.freeze(rows.map(toSeason));
  }

  /**
   * @param {Season} season
   * @param {number} at
   */
  async insert(season, at) {
    await this.#db.query("INSERT INTO seasons (id, name, starts_at, ends_at, prize_pool, entry_fee, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
      season.id,
      season.name,
      toTimestamp(season.startsAt),
      toNullableTimestamp(season.endsAt),
      season.prizePool,
      season.entryFee,
      toTimestamp(at),
    ]);
  }

  /**
   * @param {Season} season
   * @param {number} at
   */
  async update(season, at) {
    await this.#db.query("UPDATE seasons SET name = $2, starts_at = $3, ends_at = $4, prize_pool = $5, entry_fee = $6, updated_at = $7 WHERE id = $1", [
      season.id,
      season.name,
      toTimestamp(season.startsAt),
      toNullableTimestamp(season.endsAt),
      season.prizePool,
      season.entryFee,
      toTimestamp(at),
    ]);
  }

  /** @param {string} id */
  async delete(id) {
    await this.#db.query("DELETE FROM seasons WHERE id = $1", [id]);
  }
}
