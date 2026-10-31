/**
 * PostgreSQL implementation of the custody repository. One row per kept
 * account; the keys are sealed before they get here.
 */
import { toTimestamp } from "../../../platform/db/Database.js";

/** @typedef {import("../application/ports.js").CustodyRepository} CustodyRepository */

/** @implements {CustodyRepository} */
export class PgCustodyRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  async insert({ userId, network, account, postingPublic, sealed, createdAt }) {
    const result = await this.#db.query(
      `INSERT INTO custody_keys (user_id, network, account, posting_public, keys_encrypted, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [userId, network, account, postingPublic, Buffer.from(sealed), toTimestamp(createdAt)],
    );
    return result.rowCount > 0;
  }

  async find(userId) {
    const row = await this.#db.maybeOne("SELECT network, account, posting_public FROM custody_keys WHERE user_id = $1", [userId]);
    return row === null ? null : Object.freeze({ network: row.network, account: row.account, postingPublic: row.posting_public });
  }
}
