/**
 * SalesService: the public board where players sell copies for STEEM
 * (docs/tcg/14-vendite.md), and the reservations of buyers.
 *
 * - List: the seller names one of their copies and a price. The copy goes
 *   into escrow at once (locked: no deck, no trade, no other listing).
 * - Reserve: a buyer takes the listing for a few minutes and receives
 *   payment instructions: pay the seller's own account, from the buyer's
 *   account, exactly the price, with a random memo. Nobody else can buy the
 *   listing meanwhile, and the seller cannot withdraw it.
 * - The payment goes straight from buyer to seller: the server never holds
 *   funds nor keys that could move them (docs/tcg/05). SaleSettlement
 *   watches the seller's history and hands the copy over once the transfer
 *   is irreversible.
 * - Cancel (seller, nobody paying) and expiry give the copy back.
 */
import { canonicalize, sha256Hex, utf8 } from "@magic8/protocol";
import { AppError } from "../../../kernel/AppError.js";
import { isUuid, uuidV4 } from "../../../kernel/random.js";
import { formatAmount, parseAmount } from "../../economy/index.js";
import { NotificationKind } from "../../notifications/index.js";
import { BoardSort, ListingStatus, PurchaseStatus, saleMemoFrom } from "../domain/Listing.js";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const ACCOUNT_PATTERN = /^[a-z][a-z0-9.-]{2,15}$/;
const CARD_ID_PATTERN = /^[a-z0-9_]{1,64}$/;
const MEMO_RANDOM_BYTES = 17;
const MAX_BOARD_OFFSET = 10_000;

export const DEFAULT_SALES_POLICY = Object.freeze({
  /** How long a copy stays on the board. */
  listingTtlMs: 30 * 24 * 60 * 60 * 1000,
  /** Listings one player may have on the board at a time. */
  maxActiveListings: 50,
  /** Highest price, in whole units of the asset. */
  maxPrice: "100000",
  /** How long a buyer has to pay once they reserved a listing. */
  reservationTtlMs: 15 * 60 * 1000,
  /**
   * A reservation ends only this long after its deadline: a transfer made
   * just in time may reach the seller's history a little later. Whether it
   * was in time is decided by its block's timestamp.
   */
  expiryGraceMs: 2 * 60 * 1000,
  /** Reservations one buyer may hold at a time. */
  maxLivePurchases: 2,
  /** Listings per page of the board. */
  pageSize: 50,
  /** Listings and purchases in a player's own history. */
  historyLimit: 50,
  /** Listings expired per run of the job. */
  expiryBatch: 100,
});

/**
 * @typedef {typeof DEFAULT_SALES_POLICY} SalesPolicy
 * @typedef {Readonly<{ id: string, account: string, network: string }>} Player
 */

export class SalesService {
  #repository;
  #inventory;
  #assets;
  #providers;
  #notifier;
  #notifications;
  #audit;
  #clock;
  #random;
  #unitOfWork;
  #logger;
  #policy;

  /**
   * @param {{
   *   repository: import("../infrastructure/PgSalesRepository.js").PgSalesRepository,
   *   inventory: import("../../collection/index.js").InventoryService,
   *   assets: () => readonly Readonly<{ network: string, asset: string, precision: number }>[],
   *   providers: ReadonlyMap<string, import("../../payments/application/ports.js").PaymentProvider>,
   *   notifier: { send: (userId: string, type: string, data: unknown) => void },
   *   notifications: { notify: (userId: string, kind: string, data: Record<string, unknown>) => Promise<unknown> },
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   clock: import("../../../kernel/time.js").Clock,
   *   random: import("../../../kernel/random.js").SecureRandom,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   logger: import("../../../kernel/logger.js").Logger,
   *   policy?: Partial<SalesPolicy>,
   * }} deps `assets`: what may be asked as a price (the accepted assets)
   */
  constructor({ repository, inventory, assets, providers, notifier, notifications, audit, clock, random, unitOfWork, logger, policy = {} }) {
    this.#repository = repository;
    this.#inventory = inventory;
    this.#assets = assets;
    this.#providers = providers;
    this.#notifier = notifier;
    this.#notifications = notifications;
    this.#audit = audit;
    this.#clock = clock;
    this.#random = random;
    this.#unitOfWork = unitOfWork;
    this.#logger = logger;
    this.#policy = Object.freeze({ ...DEFAULT_SALES_POLICY, ...policy });
  }

  get policy() {
    return this.#policy;
  }

  /**
   * Puts one of the seller's copies on the board.
   * @param {{ seller: Player, copy: unknown, price: unknown, asset: unknown, idempotencyKey: string | null, ip: string }} request
   */
  async list({ seller, copy, price, asset, idempotencyKey, ip }) {
    if (idempotencyKey === null || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new AppError("PRECONDITION_REQUIRED", "send an Idempotency-Key header (16 to 64 letters, digits, - or _)");
    }
    const requestHash = sha256Hex(utf8(canonicalize({ copy: String(copy), price: String(price), asset: String(asset) })));
    const previous = await this.#repository.findListingByIdempotencyKey(seller.id, idempotencyKey);
    if (previous !== null) {
      return this.#replay(previous, requestHash);
    }
    const accepted = this.#assetFor(seller.network, asset);
    const units = this.#priceOf(price, accepted);
    const { instance } = await this.#inventory.card(seller.id, copy);
    if ((await this.#repository.countActiveListings(seller.id)) >= this.#policy.maxActiveListings) {
      throw new AppError("LIMIT_REACHED", `at most ${this.#policy.maxActiveListings} cards on the board at a time: withdraw one first`);
    }
    const now = this.#clock.now();
    /** @type {import("../domain/Listing.js").Listing} */
    const listing = Object.freeze({
      id: uuidV4(this.#random),
      sellerId: seller.id,
      cardInstanceId: instance.id,
      definitionId: instance.definitionId,
      network: accepted.network,
      asset: accepted.asset,
      price: units,
      status: ListingStatus.ACTIVE,
      idempotencyKey,
      requestHash,
      createdAt: now,
      expiresAt: now + this.#policy.listingTtlMs,
      closedAt: null,
    });
    try {
      await this.#unitOfWork(async () => {
        // Escrow first: it says why a copy cannot be listed (not theirs, in a trade, already on the board).
        await this.#inventory.escrow({ ownerId: seller.id, instanceIds: [instance.id], ref: refOf(listing.id) });
        if (!(await this.#repository.insertListing(listing))) {
          throw new SameKeyRace();
        }
        await this.#audit.record({ actorKind: "user", actorUserId: seller.id, action: "sales.listed", targetKind: "listing", targetId: listing.id, ip, details: { copy: instance.id, card: instance.definitionId, price: units, asset: accepted.asset } });
      });
    } catch (error) {
      if (!(error instanceof SameKeyRace)) {
        throw error;
      }
      // A concurrent request with the same key won: answer as it did.
      return this.#replay(/** @type {import("../domain/Listing.js").Listing} */ (await this.#repository.findListingByIdempotencyKey(seller.id, idempotencyKey)), requestHash);
    }
    this.#logger.info("card listed", { listing: listing.id });
    return Object.freeze({ created: true, listing: await this.listingView(listing.id) });
  }

  /**
   * The seller withdraws a listing nobody is paying for; the copy comes back.
   * @param {{ userId: string, listingId: unknown, ip: string }} request
   */
  async cancelListing({ userId, listingId, ip }) {
    const listing = await this.#unitOfWork(async () => {
      const locked = isUuid(listingId) ? await this.#repository.lockListing(/** @type {string} */ (listingId)) : null;
      if (locked === null || locked.sellerId !== userId) {
        throw new AppError("NOT_FOUND", "no such listing of yours");
      }
      if (locked.status !== ListingStatus.ACTIVE) {
        throw new AppError("CONFLICT", `this listing is already ${locked.status.toLowerCase()}`);
      }
      if ((await this.#repository.livePurchaseOf(locked.id)) !== null) {
        throw new AppError("CONFLICT", "a buyer is paying for this card right now: it can be withdrawn if they do not pay in time");
      }
      await this.#close(locked, ListingStatus.CANCELLED);
      await this.#audit.record({ actorKind: "user", actorUserId: userId, action: "sales.cancelled", targetKind: "listing", targetId: locked.id, ip });
      return locked;
    });
    this.tell(listing.id, [listing.sellerId]);
    return this.listingView(listing.id);
  }

  /** Takes off the board the listings whose time ran out, with nobody paying for them (periodic job). */
  async expireDue() {
    let expired = 0;
    for (const id of await this.#repository.listExpiredListings(this.#clock.now(), this.#policy.expiryBatch)) {
      const listing = await this.#unitOfWork(async () => {
        const locked = await this.#repository.lockListing(id);
        if (locked === null || locked.status !== ListingStatus.ACTIVE || this.#clock.now() < locked.expiresAt || (await this.#repository.livePurchaseOf(id)) !== null) {
          return null;
        }
        await this.#close(locked, ListingStatus.EXPIRED);
        await this.#notifications.notify(locked.sellerId, NotificationKind.SALE_LISTING_EXPIRED, { listingId: id, card: { definitionId: locked.definitionId } });
        await this.#audit.record({ actorKind: "system", action: "sales.expired", targetKind: "listing", targetId: id });
        return locked;
      });
      if (listing !== null) {
        expired += 1;
        this.tell(listing.id, [listing.sellerId]);
      }
    }
    return expired;
  }

  /**
   * The public board: what is on sale now, one page at a time.
   * @param {{ card?: unknown, seller?: unknown, sort?: unknown, offset?: unknown }} query
   */
  async board({ card, seller, sort, offset }) {
    const definitionId = optional(card, CARD_ID_PATTERN, "card");
    const account = optional(seller, ACCOUNT_PATTERN, "seller");
    const order = sort === undefined ? BoardSort.NEWEST : sort;
    if (order !== BoardSort.NEWEST && order !== BoardSort.CHEAPEST) {
      throw new AppError("VALIDATION", `sort: ${BoardSort.NEWEST} or ${BoardSort.CHEAPEST}`);
    }
    const start = offset === undefined ? 0 : Number(offset);
    if (!Number.isSafeInteger(start) || start < 0 || start > MAX_BOARD_OFFSET) {
      throw new AppError("VALIDATION", `offset: 0..${MAX_BOARD_OFFSET}`);
    }
    const { rows, total } = await this.#repository.board({ definitionId, seller: account, sort: order, offset: start, limit: this.#policy.pageSize, now: this.#clock.now() });
    return Object.freeze({ listings: Object.freeze(rows.map((row) => this.#listingViewOf(row))), total, offset: start, pageSize: this.#policy.pageSize });
  }

  /**
   * A player's own listings and purchases, newest first.
   * @param {string} userId
   */
  async activity(userId) {
    const listings = await this.#repository.listingsOf(userId, this.#policy.historyLimit);
    const purchases = await this.#repository.purchasesOf(userId, this.#policy.historyLimit);
    return Object.freeze({ listings: Object.freeze(listings.map((row) => this.#listingViewOf(row))), purchases: Object.freeze(purchases.map((row) => this.#purchaseViewOf(row))) });
  }

  /**
   * A buyer reserves a listing and receives the payment instructions. Asking
   * again for a listing one already holds answers with the same reservation.
   * @param {{ buyer: Player, listingId: unknown, ip: string }} request
   */
  async reserve({ buyer, listingId, ip }) {
    const listing = isUuid(listingId) ? await this.#repository.findListing(/** @type {string} */ (listingId)) : null;
    if (listing === null) {
      throw new AppError("NOT_FOUND", "no such listing");
    }
    if (listing.sellerId === buyer.id) {
      throw new AppError("VALIDATION", "this card is yours: withdraw it instead");
    }
    const held = await this.#repository.livePurchaseOf(listing.id);
    if (held !== null && held.buyerId === buyer.id) {
      return this.purchaseView(buyer.id, held.id);
    }
    if (listing.network !== buyer.network) {
      throw new AppError("VALIDATION", `this card is sold on ${listing.network}; you are signed in on ${buyer.network}`);
    }
    if ((await this.#repository.countLivePurchases(buyer.id)) >= this.#policy.maxLivePurchases) {
      throw new AppError("LIMIT_REACHED", `at most ${this.#policy.maxLivePurchases} purchases at a time: pay or release one first`);
    }
    const seller = await this.#repository.accountOf(listing.sellerId);
    const startCursor = await this.#startCursor(listing.network, seller);
    const now = this.#clock.now();
    /** @type {import("../domain/Listing.js").Purchase} */
    const purchase = Object.freeze({
      id: uuidV4(this.#random),
      listingId: listing.id,
      buyerId: buyer.id,
      payer: buyer.account,
      receiver: seller,
      network: listing.network,
      asset: listing.asset,
      amount: listing.price,
      memo: saleMemoFrom(this.#random.bytes(MEMO_RANDOM_BYTES)),
      status: PurchaseStatus.PENDING,
      startCursor,
      cursor: startCursor,
      paidBy: null,
      problem: null,
      vanished: null,
      createdAt: now,
      expiresAt: now + this.#policy.reservationTtlMs,
      closedAt: null,
    });
    const reserved = await this.#unitOfWork(async () => {
      const locked = await this.#repository.lockListing(listing.id);
      if (locked === null || locked.status !== ListingStatus.ACTIVE || now >= locked.expiresAt) {
        throw new AppError("CONFLICT", "this card is no longer on sale");
      }
      const live = await this.#repository.livePurchaseOf(listing.id);
      if (live !== null) {
        if (live.buyerId === buyer.id) {
          return live;
        }
        throw new AppError("CONFLICT", "someone is buying this card right now: try again in a few minutes");
      }
      if (!(await this.#repository.insertPurchase(purchase))) {
        throw new AppError("CONFLICT", "someone is buying this card right now: try again in a few minutes");
      }
      await this.#audit.record({ actorKind: "user", actorUserId: buyer.id, action: "sales.reserved", targetKind: "purchase", targetId: purchase.id, ip, details: { listing: listing.id, amount: purchase.amount, asset: purchase.asset, to: seller } });
      return purchase;
    });
    this.tell(listing.id, [listing.sellerId, buyer.id]);
    return this.purchaseView(buyer.id, reserved.id);
  }

  /**
   * One of the buyer's purchases.
   * @param {string} userId
   * @param {unknown} purchaseId
   */
  async purchaseView(userId, purchaseId) {
    const row = isUuid(purchaseId) ? await this.#repository.purchaseRow(/** @type {string} */ (purchaseId)) : null;
    // Someone else's purchase is "not found": ids of other players' purchases reveal nothing.
    if (row === null || row.purchase.buyerId !== userId) {
      throw new AppError("NOT_FOUND", "no such purchase");
    }
    return this.#purchaseViewOf(row);
  }

  /** @param {string} listingId */
  async listingView(listingId) {
    const row = await this.#repository.listingRow(listingId);
    if (row === null) {
      throw new AppError("NOT_FOUND", "no such listing");
    }
    return this.#listingViewOf(row);
  }

  /**
   * An amount as a decimal string of the asset's precision ("1.500").
   * @param {number} units
   * @param {string} asset
   */
  formatPrice(units, asset) {
    const accepted = this.#assets().find((candidate) => candidate.asset === asset);
    if (accepted === undefined) {
      throw new Error(`SalesService: unknown asset ${asset}`);
    }
    return formatAmount(units, accepted.precision);
  }

  /**
   * The players concerned learn that a listing changed (they re-read it).
   * @param {string} listingId
   * @param {readonly string[]} userIds
   */
  tell(listingId, userIds) {
    for (const userId of new Set(userIds)) {
      this.#notifier.send(userId, "sale.updated", { listingId });
    }
  }

  /**
   * Where the watcher starts reading the seller's history for this payment: after its newest entry now.
   * @param {string} network
   * @param {string} seller
   */
  async #startCursor(network, seller) {
    const provider = this.#providers.get(network);
    if (provider === undefined) {
      throw new AppError("CHAIN_UNAVAILABLE", `payments on ${network} cannot be checked`);
    }
    try {
      return await provider.latestCursor(seller);
    } catch (error) {
      this.#logger.warn("seller history could not be read", { seller, error: error instanceof Error ? error.message : String(error) });
      throw new AppError("CHAIN_UNAVAILABLE", "the chain cannot be read right now: try again in a moment");
    }
  }

  /**
   * @param {import("../domain/Listing.js").Listing} listing
   * @param {string} status
   */
  async #close(listing, status) {
    await this.#inventory.release({ instanceIds: [listing.cardInstanceId], ref: refOf(listing.id) });
    await this.#repository.closeListing(listing.id, status, this.#clock.now());
  }

  /**
   * @param {string} network
   * @param {unknown} asset
   */
  #assetFor(network, asset) {
    const accepted = this.#assets().find((candidate) => candidate.asset === asset && candidate.network === network);
    if (accepted === undefined) {
      const names = this.#assets().filter((candidate) => candidate.network === network).map((candidate) => candidate.asset);
      throw new AppError("VALIDATION", `asset: one of ${names.join(", ") || "none"} on ${network}`);
    }
    return accepted;
  }

  /**
   * @param {unknown} price a decimal string
   * @param {Readonly<{ asset: string, precision: number }>} accepted
   */
  #priceOf(price, accepted) {
    const units = parseAmount(price, accepted.precision);
    const max = /** @type {number} */ (parseAmount(this.#policy.maxPrice, accepted.precision));
    if (units === null || units < 1 || units > max) {
      throw new AppError("VALIDATION", `price: a decimal ${accepted.asset} amount with at most ${accepted.precision} decimals, from ${formatAmount(1, accepted.precision)} to ${this.#policy.maxPrice}`);
    }
    return units;
  }

  /**
   * @param {import("../domain/Listing.js").Listing} listing
   * @param {string} requestHash
   */
  async #replay(listing, requestHash) {
    if (listing.requestHash !== requestHash) {
      throw new AppError("CONFLICT", "this Idempotency-Key was used for a different listing");
    }
    return Object.freeze({ created: false, listing: await this.listingView(listing.id) });
  }


  /** @param {import("../infrastructure/PgSalesRepository.js").ListingRow} row */
  #listingViewOf({ listing, seller, card, reserved, buyer }) {
    return Object.freeze({
      id: listing.id,
      status: listing.status,
      seller,
      card,
      price: Object.freeze({ asset: listing.asset, amount: this.formatPrice(listing.price, listing.asset) }),
      reserved: listing.status === ListingStatus.ACTIVE && reserved,
      buyer,
      createdAt: listing.createdAt,
      expiresAt: listing.expiresAt,
      closedAt: listing.closedAt,
    });
  }

  /** @param {import("../infrastructure/PgSalesRepository.js").PurchaseRow} row */
  #purchaseViewOf({ purchase, seller, card }) {
    const amount = this.formatPrice(purchase.amount, purchase.asset);
    return Object.freeze({
      id: purchase.id,
      listingId: purchase.listingId,
      status: purchase.status,
      seller,
      card,
      price: Object.freeze({ asset: purchase.asset, amount }),
      // Instructions only while paying is still possible.
      payment:
        purchase.status === PurchaseStatus.PENDING
          ? Object.freeze({ network: purchase.network, from: purchase.payer, to: purchase.receiver, asset: purchase.asset, amount, memo: purchase.memo, expiresAt: purchase.expiresAt })
          : null,
      txId: purchase.paidBy?.txId ?? null,
      problem: purchase.problem,
      createdAt: purchase.createdAt,
      expiresAt: purchase.expiresAt,
      closedAt: purchase.closedAt,
    });
  }
}

/** Rolls back a listing whose idempotency key a concurrent request took first. */
class SameKeyRace extends Error {}

/** @param {string} listingId */
export const refOf = (listingId) => `sale:${listingId}`;

/**
 * @param {unknown} value
 * @param {RegExp} pattern
 * @param {string} name
 * @returns {string | null}
 */
function optional(value, pattern, name) {
  if (value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new AppError("VALIDATION", `${name}: not a valid filter`);
  }
  return value;
}
