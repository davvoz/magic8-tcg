/** entry_balances and entry_ledger (migration 016). */
import { toTimestamp } from "../../../platform/db/Database.js";

/**
 * @typedef {Readonly<{ userId: string, kind: string, reason: string, ref: string, delta: number, season: string | null }>} LedgerEntry
 */

export class PgEntryRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  /**
   * @param {string} userId
   * @param {string} kind
   * @returns {Promise<number>} 0 for a player who never had any
   */
  async balanceOf(userId, kind) {
    const row = await this.#db.maybeOne("SELECT balance FROM entry_balances WHERE user_id = $1 AND kind = $2", [userId, kind]);
    return row === null ? 0 : row.balance;
  }

  /**
   * The balances of several players, locked until the unit of work ends (in user id order: two charges never deadlock).
   * @param {readonly string[]} userIds
   * @param {string} kind
   * @returns {Promise<ReadonlyMap<string, number>>} every player asked for, 0 when they have no row
   */
  async lockBalances(userIds, kind) {
    const rows = await this.#db.rows("SELECT user_id, balance FROM entry_balances WHERE user_id = ANY($1) AND kind = $2 ORDER BY user_id FOR UPDATE", [userIds, kind]);
    const found = new Map(rows.map((row) => [row.user_id, row.balance]));
    return new Map(userIds.map((userId) => [userId, found.get(userId) ?? 0]));
  }

  /**
   * Records a change once (the ledger's key) and applies it to the balance.
   * A charge larger than the balance changes nothing.
   * @param {LedgerEntry & { at: number }} entry
   * @returns {Promise<"applied" | "duplicate" | "insufficient">}
   */
  async apply({ userId, kind, reason, ref, delta, season, at }) {
    const recorded = await this.#db.maybeOne(
      "INSERT INTO entry_ledger (user_id, kind, reason, ref, delta, season, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING ref",
      [userId, kind, reason, ref, delta, season, toTimestamp(at)],
    );
    if (recorded === null) {
      return "duplicate";
    }
    if (delta > 0) {
      await this.#db.query(
        `INSERT INTO entry_balances (user_id, kind, balance, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, kind) DO UPDATE SET balance = entry_balances.balance + EXCLUDED.balance, updated_at = EXCLUDED.updated_at`,
        [userId, kind, delta, toTimestamp(at)],
      );
      return "applied";
    }
    const charged = await this.#db.maybeOne("UPDATE entry_balances SET balance = balance + $3, updated_at = $4 WHERE user_id = $1 AND kind = $2 AND balance + $3 >= 0 RETURNING balance", [userId, kind, delta, toTimestamp(at)]);
    return charged === null ? "insufficient" : "applied";
  }

  /**
   * @param {string} reason
   * @param {string} ref
   * @returns {Promise<readonly LedgerEntry[]>}
   */
  async entriesFor(reason, ref) {
    const rows = await this.#db.rows("SELECT user_id, kind, reason, ref, delta, season FROM entry_ledger WHERE reason = $1 AND ref = $2 ORDER BY user_id, kind", [reason, ref]);
    return Object.freeze(rows.map((row) => Object.freeze({ userId: row.user_id, kind: row.kind, reason: row.reason, ref: row.ref, delta: row.delta, season: row.season })));
  }
}
