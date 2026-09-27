/**
 * listings and listing_purchases (docs/tcg/14-vendite.md). Both leave their
 * live states with a compare-and-set on the status; a listing's row lock
 * (`lockListing`) serialises everything that may start or end a sale of it.
 */
import { fromTimestamp, toTimestamp } from "../../../platform/db/Database.js";
import { BoardSort } from "../domain/Listing.js";

/** @param {import("../../../platform/db/Database.js").Row} row @returns {import("../domain/Listing.js").Listing} */
function toListing(row) {
  return Object.freeze({
    id: row.id,
    sellerId: row.seller_id,
    cardInstanceId: row.card_instance_id,
    definitionId: row.definition_id,
    network: row.network,
    asset: row.asset,
    price: row.price,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    createdAt: fromTimestamp(row.created_at),
    expiresAt: fromTimestamp(row.expires_at),
    closedAt: row.closed_at === null ? null : fromTimestamp(row.closed_at),
  });
}

/** @param {import("../../../platform/db/Database.js").Row} row @returns {import("../domain/Listing.js").Purchase} */
function toPurchase(row) {
  return Object.freeze({
    id: row.id,
    listingId: row.listing_id,
    buyerId: row.buyer_id,
    payer: row.payer,
    receiver: row.receiver,
    network: row.network,
    asset: row.asset,
    amount: row.amount,
    memo: row.memo,
    status: row.status,
    startCursor: row.start_cursor,
    cursor: row.cursor,
    paidBy: row.tx_id === null ? null : Object.freeze({ txId: row.tx_id, opIndex: row.op_index, blockNum: row.block_num, time: fromTimestamp(row.block_time) }),
    problem: row.problem,
    vanished: row.vanished_tx_id === null ? null : Object.freeze({ txId: row.vanished_tx_id, blockNum: row.vanished_block_num }),
    createdAt: fromTimestamp(row.created_at),
    expiresAt: fromTimestamp(row.expires_at),
    closedAt: row.closed_at === null ? null : fromTimestamp(row.closed_at),
  });
}

/**
 * @typedef {Readonly<{ id: string, definitionId: string, edition: string, serial: number }>} ListedCard
 * @typedef {Readonly<{ listing: import("../domain/Listing.js").Listing, seller: string, card: ListedCard, reserved: boolean, buyer: string | null }>} ListingRow
 *   `buyer`: who bought it, once sold
 * @typedef {Readonly<{ purchase: import("../domain/Listing.js").Purchase, listing: import("../domain/Listing.js").Listing, seller: string, card: ListedCard }>} PurchaseRow
 */

const LISTING_COLUMNS = Object.freeze(["id", "seller_id", "card_instance_id", "definition_id", "network", "asset", "price", "status", "idempotency_key", "request_hash", "created_at", "expires_at", "closed_at"]);

/** The listing's columns next to a purchase's, prefixed with l_. */
const PREFIXED_LISTING_COLUMNS = LISTING_COLUMNS.map((column) => `l.${column} AS l_${column}`).join(", ");

/** The columns every listing row is read with: the copy, the seller, and whether someone is buying it or bought it. */
const LISTING_DETAILS = `
  SELECT l.*, s.account AS seller_account, ci.edition, ci.serial,
         EXISTS (SELECT 1 FROM listing_purchases p WHERE p.listing_id = l.id AND p.status IN ('PENDING', 'DETECTED')) AS reserved,
         (SELECT b.account FROM listing_purchases p JOIN users b ON b.id = p.buyer_id WHERE p.listing_id = l.id AND p.status = 'COMPLETED') AS buyer_account
    FROM listings l JOIN users s ON s.id = l.seller_id JOIN card_instances ci ON ci.id = l.card_instance_id`;

/** @param {import("../../../platform/db/Database.js").Row} row @returns {ListingRow} */
function toListingRow(row) {
  return Object.freeze({
    listing: toListing(row),
    seller: row.seller_account,
    card: Object.freeze({ id: row.card_instance_id, definitionId: row.definition_id, edition: row.edition, serial: row.serial }),
    reserved: row.reserved,
    buyer: row.buyer_account,
  });
}

export class PgSalesRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  /**
   * @param {import("../domain/Listing.js").Listing} listing
   * @returns {Promise<boolean>} false when the seller already used that idempotency key (nothing is written)
   */
  async insertListing(listing) {
    const rows = await this.#db.rows(
      `INSERT INTO listings (id, seller_id, card_instance_id, definition_id, network, asset, price, status, idempotency_key, request_hash, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (seller_id, idempotency_key) DO NOTHING RETURNING id`,
      [listing.id, listing.sellerId, listing.cardInstanceId, listing.definitionId, listing.network, listing.asset, listing.price, listing.status, listing.idempotencyKey, listing.requestHash, toTimestamp(listing.createdAt), toTimestamp(listing.expiresAt)],
    );
    return rows.length === 1;
  }

  /**
   * @param {string} sellerId
   * @param {string} key
   */
  async findListingByIdempotencyKey(sellerId, key) {
    const row = await this.#db.maybeOne("SELECT * FROM listings WHERE seller_id = $1 AND idempotency_key = $2", [sellerId, key]);
    return row === null ? null : toListing(row);
  }

  /** @param {string} id */
  async findListing(id) {
    const row = await this.#db.maybeOne("SELECT * FROM listings WHERE id = $1", [id]);
    return row === null ? null : toListing(row);
  }

  /** @param {string} id the listing, locked until the unit of work ends */
  async lockListing(id) {
    const row = await this.#db.maybeOne("SELECT * FROM listings WHERE id = $1 FOR UPDATE", [id]);
    return row === null ? null : toListing(row);
  }

  /**
   * ACTIVE → `status`; false when the listing was no longer active.
   * @param {string} id
   * @param {string} status
   * @param {number} at
   */
  async closeListing(id, status, at) {
    const rows = await this.#db.rows("UPDATE listings SET status = $2, closed_at = $3 WHERE id = $1 AND status = 'ACTIVE' RETURNING id", [id, status, toTimestamp(at)]);
    return rows.length === 1;
  }

  /** @param {string} sellerId */
  async countActiveListings(sellerId) {
    const row = await this.#db.maybeOne("SELECT count(*)::integer AS active FROM listings WHERE seller_id = $1 AND status = 'ACTIVE'", [sellerId]);
    return row?.active ?? 0;
  }

  /**
   * The public board: active listings not past their time, filtered and sorted, one page and the total.
   * @param {{ definitionIds: readonly string[] | null, seller: string | null, sort: string, offset: number, limit: number, now: number }} query
   * @returns {Promise<Readonly<{ rows: readonly ListingRow[], total: number }>>}
   */
  async board({ definitionIds, seller, sort, offset, limit, now }) {
    const where = "l.status = 'ACTIVE' AND l.expires_at > $1 AND ($2::text[] IS NULL OR l.definition_id = ANY($2::text[])) AND ($3::text IS NULL OR s.account = $3)";
    const order = sort === BoardSort.CHEAPEST ? "l.price ASC, l.created_at DESC, l.id" : "l.created_at DESC, l.id";
    const params = [toTimestamp(now), definitionIds === null ? null : [...definitionIds], seller];
    const rows = await this.#db.rows(`${LISTING_DETAILS} WHERE ${where} ORDER BY ${order} LIMIT $4 OFFSET $5`, [...params, limit, offset]);
    const count = await this.#db.maybeOne(`SELECT count(*)::integer AS total FROM listings l JOIN users s ON s.id = l.seller_id WHERE ${where}`, params);
    return Object.freeze({ rows: Object.freeze(rows.map(toListingRow)), total: count?.total ?? 0 });
  }

  /**
   * A seller's listings, newest first.
   * @param {string} sellerId
   * @param {number} limit
   */
  async listingsOf(sellerId, limit) {
    const rows = await this.#db.rows(`${LISTING_DETAILS} WHERE l.seller_id = $1 ORDER BY l.created_at DESC, l.id LIMIT $2`, [sellerId, limit]);
    return Object.freeze(rows.map(toListingRow));
  }

  /** @param {string} id */
  async listingRow(id) {
    const row = await this.#db.maybeOne(`${LISTING_DETAILS} WHERE l.id = $1`, [id]);
    return row === null ? null : toListingRow(row);
  }

  /**
   * Active listings past their time that nobody is paying for.
   * @param {number} now
   * @param {number} limit
   * @returns {Promise<readonly string[]>}
   */
  async listExpiredListings(now, limit) {
    const rows = await this.#db.rows(
      `SELECT l.id FROM listings l
        WHERE l.status = 'ACTIVE' AND l.expires_at <= $1
          AND NOT EXISTS (SELECT 1 FROM listing_purchases p WHERE p.listing_id = l.id AND p.status IN ('PENDING', 'DETECTED'))
        ORDER BY l.expires_at LIMIT $2`,
      [toTimestamp(now), limit],
    );
    return Object.freeze(rows.map((row) => row.id));
  }

  /**
   * @param {import("../domain/Listing.js").Purchase} purchase
   * @returns {Promise<boolean>} false when the listing already has a live purchase (nothing is written)
   */
  async insertPurchase(purchase) {
    const rows = await this.#db.rows(
      `INSERT INTO listing_purchases (id, listing_id, buyer_id, payer, receiver, network, asset, amount, memo, status, start_cursor, cursor, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12, $13)
       ON CONFLICT DO NOTHING RETURNING id`,
      [purchase.id, purchase.listingId, purchase.buyerId, purchase.payer, purchase.receiver, purchase.network, purchase.asset, purchase.amount, purchase.memo, purchase.status, purchase.startCursor, toTimestamp(purchase.createdAt), toTimestamp(purchase.expiresAt)],
    );
    return rows.length === 1;
  }

  /** @param {string} id */
  async findPurchase(id) {
    const row = await this.#db.maybeOne("SELECT * FROM listing_purchases WHERE id = $1", [id]);
    return row === null ? null : toPurchase(row);
  }

  /** @param {string} listingId the purchase holding the listing, if any */
  async livePurchaseOf(listingId) {
    const row = await this.#db.maybeOne("SELECT * FROM listing_purchases WHERE listing_id = $1 AND status IN ('PENDING', 'DETECTED')", [listingId]);
    return row === null ? null : toPurchase(row);
  }

  /** @param {string} buyerId */
  async countLivePurchases(buyerId) {
    const row = await this.#db.maybeOne("SELECT count(*)::integer AS live FROM listing_purchases WHERE buyer_id = $1 AND status IN ('PENDING', 'DETECTED')", [buyerId]);
    return row?.live ?? 0;
  }

  /**
   * Live purchases, oldest first: what the settlement job watches.
   * @param {number} limit
   */
  async listLivePurchases(limit) {
    const rows = await this.#db.rows("SELECT * FROM listing_purchases WHERE status IN ('PENDING', 'DETECTED') ORDER BY created_at, id LIMIT $1", [limit]);
    return Object.freeze(rows.map(toPurchase));
  }

  /**
   * `from` → `to`, compare-and-set; null when the purchase was no longer in `from`.
   * @param {string} id
   * @param {string} from
   * @param {string} to
   * @param {{ paidBy?: import("../domain/Listing.js").PaidBy | null, cursor?: number, closedAt?: number, vanished?: Readonly<{ txId: string, blockNum: number }> }} changes
   */
  async transitionPurchase(id, from, to, changes) {
    const row = await this.#db.maybeOne(
      `UPDATE listing_purchases
          SET status = $3,
              tx_id = CASE WHEN $4 THEN tx_id ELSE $5 END,
              op_index = CASE WHEN $4 THEN op_index ELSE $6 END,
              block_num = CASE WHEN $4 THEN block_num ELSE $7 END,
              block_time = CASE WHEN $4 THEN block_time ELSE $8 END,
              cursor = COALESCE($9, cursor),
              closed_at = COALESCE($10, closed_at),
              vanished_tx_id = COALESCE($11, vanished_tx_id),
              vanished_block_num = COALESCE($12, vanished_block_num)
        WHERE id = $1 AND status = $2 RETURNING *`,
      [id, from, to, ...transitionParams(changes)],
    );
    return row === null ? null : toPurchase(row);
  }

  /**
   * How far the seller's history was read for a pending purchase.
   * @param {string} id
   * @param {number} cursor
   */
  async saveCursor(id, cursor) {
    await this.#db.query("UPDATE listing_purchases SET cursor = $2 WHERE id = $1 AND status = 'PENDING'", [id, cursor]);
  }

  /**
   * A transfer carried the purchase's memo but did not pay it (the buyer is told why).
   * @param {string} id
   * @param {string} problem
   */
  async setProblem(id, problem) {
    await this.#db.query("UPDATE listing_purchases SET problem = $2 WHERE id = $1", [id, problem]);
  }

  /**
   * A purchase with its listing, the copy and the seller.
   * @param {string} id
   * @returns {Promise<PurchaseRow | null>}
   */
  async purchaseRow(id) {
    const rows = await this.#purchaseRows("p.id = $1", [id], 1);
    return rows[0] ?? null;
  }

  /**
   * A buyer's purchases, newest first.
   * @param {string} buyerId
   * @param {number} limit
   */
  purchasesOf(buyerId, limit) {
    return this.#purchaseRows("p.buyer_id = $1", [buyerId], limit);
  }

  /**
   * @param {string} where
   * @param {readonly unknown[]} params
   * @param {number} limit
   * @returns {Promise<readonly PurchaseRow[]>}
   */
  async #purchaseRows(where, params, limit) {
    const rows = await this.#db.rows(
      `SELECT p.*, ${PREFIXED_LISTING_COLUMNS}, s.account AS seller_account, ci.edition, ci.serial
         FROM listing_purchases p JOIN listings l ON l.id = p.listing_id JOIN users s ON s.id = l.seller_id JOIN card_instances ci ON ci.id = l.card_instance_id
        WHERE ${where} ORDER BY p.created_at DESC, p.id LIMIT $${params.length + 1}`,
      [...params, limit],
    );
    return Object.freeze(
      rows.map((row) => {
        const listing = toListing(Object.fromEntries(LISTING_COLUMNS.map((column) => [column, row[`l_${column}`]])));
        return Object.freeze({
          purchase: toPurchase(row),
          listing,
          seller: row.seller_account,
          card: Object.freeze({ id: listing.cardInstanceId, definitionId: listing.definitionId, edition: row.edition, serial: row.serial }),
        });
      }),
    );
  }

  /** @param {string} userId */
  async accountOf(userId) {
    const row = await this.#db.maybeOne("SELECT account FROM users WHERE id = $1", [userId]);
    if (row === null) {
      throw new Error(`user ${userId} does not exist`);
    }
    return /** @type {string} */ (row.account);
  }
}

/**
 * Parameters $4..$12 of transitionPurchase: the payment (kept when `paidBy` is absent, cleared when null), cursor, closing time, vanished transfer.
 * @param {{ paidBy?: import("../domain/Listing.js").PaidBy | null, cursor?: number, closedAt?: number, vanished?: Readonly<{ txId: string, blockNum: number }> }} changes
 */
function transitionParams({ paidBy, cursor, closedAt, vanished }) {
  const payment = paidBy === undefined || paidBy === null ? [null, null, null, null] : [paidBy.txId, paidBy.opIndex, paidBy.blockNum, toTimestamp(paidBy.time)];
  return [paidBy === undefined, ...payment, cursor ?? null, closedAt === undefined ? null : toTimestamp(closedAt), vanished?.txId ?? null, vanished?.blockNum ?? null];
}
