/** season_jackpots and season_prizes (migration 015). */
import { fromNullableTimestamp, fromTimestamp, toTimestamp } from "../../../platform/db/Database.js";

/**
 * @typedef {Readonly<{ season: string, network: string, bankAccount: string, asset: string, openingBalance: number, openedAt: number, closingBalance: number | null, jackpot: number | null, settledAt: number | null }>} StoredJackpot
 * @typedef {Readonly<{ season: string, place: number, userId: string, account: string, network: string, asset: string, amount: number, percent: number, rating: number, status: string,
 *   transfer: Readonly<{ txId: string, opIndex: number, blockNum: number, time: number }> | null, confirmedAt: number | null, createdAt: number }>} StoredPrize
 */

/** @param {import("../../../platform/db/Database.js").Row} row @returns {StoredJackpot} */
const toJackpot = (row) =>
  Object.freeze({
    season: row.season,
    network: row.network,
    bankAccount: row.bank_account,
    asset: row.asset,
    openingBalance: Number(row.opening_balance),
    openedAt: fromTimestamp(row.opened_at),
    closingBalance: row.closing_balance === null ? null : Number(row.closing_balance),
    jackpot: row.jackpot === null ? null : Number(row.jackpot),
    settledAt: fromNullableTimestamp(row.settled_at),
  });

/** @param {import("../../../platform/db/Database.js").Row} row @returns {StoredPrize} */
const toPrize = (row) =>
  Object.freeze({
    season: row.season,
    place: row.place,
    userId: row.user_id,
    account: row.account,
    network: row.network,
    asset: row.asset,
    amount: Number(row.amount),
    percent: row.percent,
    rating: row.rating,
    status: row.status,
    transfer: row.tx_id === null ? null : Object.freeze({ txId: row.tx_id, opIndex: row.op_index, blockNum: Number(row.block_num), time: fromTimestamp(row.sent_at) }),
    confirmedAt: fromNullableTimestamp(row.confirmed_at),
    createdAt: fromTimestamp(row.created_at),
  });

export class PgJackpotRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  /**
   * @param {string} season
   * @returns {Promise<StoredJackpot | null>}
   */
  async find(season) {
    const row = await this.#db.maybeOne("SELECT * FROM season_jackpots WHERE season = $1", [season]);
    return row === null ? null : toJackpot(row);
  }

  /**
   * Records the bank's balance as the season's opening one, unless it already has one.
   * @param {{ season: string, network: string, bankAccount: string, asset: string, balance: number, at: number }} opening
   */
  async open({ season, network, bankAccount, asset, balance, at }) {
    await this.#db.query(
      "INSERT INTO season_jackpots (season, network, bank_account, asset, opening_balance, opened_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (season) DO NOTHING",
      [season, network, bankAccount, asset, balance, toTimestamp(at)],
    );
  }

  /**
   * Settles an open season (compare-and-set: a second settlement changes nothing).
   * @param {{ season: string, closingBalance: number, jackpot: number, at: number }} settlement
   * @returns {Promise<boolean>} true when this call settled it
   */
  async settle({ season, closingBalance, jackpot, at }) {
    const row = await this.#db.maybeOne(
      "UPDATE season_jackpots SET closing_balance = $2, jackpot = $3, settled_at = $4 WHERE season = $1 AND settled_at IS NULL RETURNING season",
      [season, closingBalance, jackpot, toTimestamp(at)],
    );
    return row !== null;
  }

  /**
   * @param {{ season: string, place: number, userId: string, account: string, network: string, asset: string, amount: number, percent: number, rating: number, at: number }} prize
   */
  async insertPrize({ season, place, userId, account, network, asset, amount, percent, rating, at }) {
    await this.#db.query(
      `INSERT INTO season_prizes (season, place, user_id, account, network, asset, amount, percent, rating, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', $10)`,
      [season, place, userId, account, network, asset, amount, percent, rating, toTimestamp(at)],
    );
  }

  /**
   * @param {string} season
   * @returns {Promise<readonly StoredPrize[]>} first place first
   */
  async prizesOf(season) {
    return Object.freeze((await this.#db.rows("SELECT * FROM season_prizes WHERE season = $1 ORDER BY place", [season])).map(toPrize));
  }

  /**
   * @param {string} season
   * @param {number} place
   * @returns {Promise<StoredPrize | null>}
   */
  async findPrize(season, place) {
    const row = await this.#db.maybeOne("SELECT * FROM season_prizes WHERE season = $1 AND place = $2", [season, place]);
    return row === null ? null : toPrize(row);
  }

  /**
   * @param {readonly string[]} statuses
   * @param {number} limit
   * @returns {Promise<readonly StoredPrize[]>} oldest first
   */
  async listPrizes(statuses, limit) {
    return Object.freeze((await this.#db.rows("SELECT * FROM season_prizes WHERE status = ANY($1) ORDER BY created_at, season, place LIMIT $2", [statuses, limit])).map(toPrize));
  }

  /**
   * PENDING → SENT, compare-and-set.
   * @param {string} season
   * @param {number} place
   * @param {{ txId: string, opIndex: number, blockNum: number, time: number }} transfer
   */
  async markSent(season, place, transfer) {
    const row = await this.#db.maybeOne(
      "UPDATE season_prizes SET status = 'SENT', tx_id = $3, op_index = $4, block_num = $5, sent_at = $6 WHERE season = $1 AND place = $2 AND status = 'PENDING' RETURNING season",
      [season, place, transfer.txId, transfer.opIndex, transfer.blockNum, toTimestamp(transfer.time)],
    );
    return row !== null;
  }

  /**
   * SENT → CONFIRMED.
   * @param {string} season
   * @param {number} place
   * @param {number} at
   */
  async confirm(season, place, at) {
    const row = await this.#db.maybeOne("UPDATE season_prizes SET status = 'CONFIRMED', confirmed_at = $3 WHERE season = $1 AND place = $2 AND status = 'SENT' RETURNING season", [season, place, toTimestamp(at)]);
    return row !== null;
  }

  /**
   * SENT → PENDING: the transfer vanished from the chain.
   * @param {string} season
   * @param {number} place
   */
  async reopen(season, place) {
    const row = await this.#db.maybeOne(
      "UPDATE season_prizes SET status = 'PENDING', tx_id = NULL, op_index = NULL, block_num = NULL, sent_at = NULL WHERE season = $1 AND place = $2 AND status = 'SENT' RETURNING season",
      [season, place],
    );
    return row !== null;
  }
}
