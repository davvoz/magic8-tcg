/**
 * The announced maintenance in PostgreSQL: the single row of `maintenance`, or none.
 */
import { fromTimestamp, toTimestamp } from "../../../platform/db/Database.js";

export class PgMaintenanceRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} database */
  constructor(database) {
    this.#db = database;
  }

  /** @returns {Promise<import("../application/MaintenanceService.js").MaintenanceNotice | null>} */
  async find() {
    const row = await this.#db.maybeOne("SELECT starts_at, message FROM maintenance");
    return row === null ? null : Object.freeze({ startsAt: fromTimestamp(row.starts_at), message: row.message });
  }

  /**
   * Replaces the announcement, if any.
   * @param {{ startsAt: number, message: string | null, at: number }} notice
   */
  async save({ startsAt, message, at }) {
    await this.#db.query(
      "INSERT INTO maintenance (singleton, starts_at, message, announced_at) VALUES (true, $1, $2, $3) ON CONFLICT (singleton) DO UPDATE SET starts_at = EXCLUDED.starts_at, message = EXCLUDED.message, announced_at = EXCLUDED.announced_at",
      [toTimestamp(startsAt), message, toTimestamp(at)],
    );
  }

  /** @returns {Promise<boolean>} whether there was an announcement */
  async clear() {
    const result = await this.#db.query("DELETE FROM maintenance");
    return result.rowCount > 0;
  }
}
