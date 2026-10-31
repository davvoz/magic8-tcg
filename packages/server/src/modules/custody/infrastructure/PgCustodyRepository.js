/**
 * PostgreSQL implementation of the custody repository. One row per kept
 * account; the keys are sealed before they get here. One row per transfer
 * signed for a payment reference: the primary key on the memo makes sure
 * two requests cannot both sign it.
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

  async findSealed(userId) {
    const row = await this.#db.maybeOne("SELECT network, account, keys_encrypted FROM custody_keys WHERE user_id = $1", [userId]);
    return row === null ? null : Object.freeze({ network: row.network, account: row.account, sealed: new Uint8Array(row.keys_encrypted) });
  }

  async remove(userId) {
    const result = await this.#db.query("DELETE FROM custody_keys WHERE user_id = $1", [userId]);
    return result.rowCount > 0;
  }

  async claimTransfer(memo, userId, at) {
    const result = await this.#db.query("INSERT INTO custody_transfers (memo, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [memo, userId, toTimestamp(at)]);
    return result.rowCount > 0;
  }

  async recordTransfer(memo, txId) {
    await this.#db.query("UPDATE custody_transfers SET tx_id = $2 WHERE memo = $1", [memo, txId]);
  }

  async transferOf(memo) {
    const row = await this.#db.maybeOne("SELECT tx_id FROM custody_transfers WHERE memo = $1", [memo]);
    return row?.tx_id ?? null;
  }

  async releaseTransfer(memo) {
    await this.#db.query("DELETE FROM custody_transfers WHERE memo = $1", [memo]);
  }
}
