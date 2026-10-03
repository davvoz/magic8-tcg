/**
 * EntryService: the entries each player holds and what games take from them
 * (docs/tcg/22-ingressi-ranked.md).
 *
 * - Entries are bought in the shop: one payment, as many entries as the
 *   player wants, so the wallet is asked once and not before every game. The
 *   marketplace credits them when it fulfils the order (`credit`).
 * - A game of a paid mode takes its fee from every player in the unit of
 *   work that creates it (`charge`): no game without the fee, no fee without
 *   the game. Matchmaking checks first (`shortOf`) so a player whose entries
 *   ran out leaves the queue instead of blocking it.
 * - A game called off before it started gives the fee back (`refundGame`),
 *   in the unit of work that calls it off.
 * - Every change is a row of an append-only ledger keyed by its reason and
 *   reference (order, game): retries and concurrent workers apply it once,
 *   and a balance never goes below zero.
 *
 * What a game costs is not decided here: the fee policy (`fees`) says it,
 * for ranked play from the running season's rules.
 */
import { AppError } from "../../../kernel/AppError.js";
import { ENTRY_KINDS, EntryReason, FREE_PLAY, entriesText } from "../domain/Entry.js";

export class EntryService {
  #repository;
  #fees;
  #clock;
  #unitOfWork;
  #logger;
  #kinds;

  /**
   * @param {{
   *   repository: import("../infrastructure/PgEntryRepository.js").PgEntryRepository,
   *   fees?: { feeOf: (mode: string) => import("../domain/Entry.js").Fee | null },
   *   clock: import("../../../kernel/time.js").Clock,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   logger: import("../../../kernel/logger.js").Logger,
   *   kinds?: readonly string[],
   * }} deps `fees`: what a game of each mode costs now (by default nothing does)
   */
  constructor({ repository, fees = FREE_PLAY, clock, unitOfWork, logger, kinds = ENTRY_KINDS }) {
    this.#repository = repository;
    this.#fees = fees;
    this.#clock = clock;
    this.#unitOfWork = unitOfWork;
    this.#logger = logger;
    this.#kinds = kinds;
  }

  /** The kinds of entry the shop may sell. */
  get kinds() {
    return this.#kinds;
  }

  /**
   * What a game of `mode` costs now; null when it is free.
   * @param {string} mode
   */
  feeOf(mode) {
    return this.#kinds.includes(mode) ? this.#fees.feeOf(mode) : null;
  }

  /**
   * A player's entries of every kind, and what a game costs now.
   * @param {string} userId
   * @returns {Promise<readonly import("../domain/Entry.js").EntryView[]>}
   */
  async view(userId) {
    const views = [];
    for (const kind of this.#kinds) {
      const fee = this.feeOf(kind);
      views.push(Object.freeze({ kind, balance: await this.#repository.balanceOf(userId, kind), perGame: fee?.count ?? 0, season: fee?.season ?? null }));
    }
    return Object.freeze(views);
  }

  /**
   * Refuses a game of a paid mode to a player without the entries it costs.
   * @param {string} userId
   * @param {string} mode
   */
  async assertCanEnter(userId, mode) {
    const fee = this.feeOf(mode);
    if (fee !== null && (await this.#repository.balanceOf(userId, mode)) < fee.count) {
      throw entryRequired(mode, fee.count);
    }
  }

  /**
   * The players who could not pay a game of `mode` now. Inside a unit of work their balances stay locked until it ends, so a `charge` that follows cannot fail.
   * @param {readonly string[]} userIds
   * @param {string} mode
   * @returns {Promise<readonly string[]>}
   */
  async shortOf(userIds, mode) {
    const fee = this.feeOf(mode);
    if (fee === null) {
      return Object.freeze([]);
    }
    const balances = await this.#repository.lockBalances(userIds, mode);
    return Object.freeze(userIds.filter((userId) => (balances.get(userId) ?? 0) < fee.count));
  }

  /**
   * Takes a game's fee from each of its players. Joins the caller's unit of work (the one that creates the game);
   * a player without enough entries fails it whole.
   * @param {{ gameId: string, mode: string, userIds: readonly string[] }} game
   * @returns {Promise<number>} entries taken from each player (0: free)
   */
  charge({ gameId, mode, userIds }) {
    const fee = this.feeOf(mode);
    if (fee === null) {
      return Promise.resolve(0);
    }
    return this.#unitOfWork(async () => {
      for (const userId of [...userIds].sort()) {
        const outcome = await this.#repository.apply({ userId, kind: mode, reason: EntryReason.GAME, ref: gameId, delta: -fee.count, season: fee.season, at: this.#clock.now() });
        if (outcome === "insufficient") {
          throw entryRequired(mode, fee.count);
        }
      }
      return fee.count;
    });
  }

  /**
   * Gives back what a game took from its players (a game called off before it started). Idempotent.
   * @param {string} gameId
   * @returns {Promise<number>} players refunded by this call
   */
  refundGame(gameId) {
    return this.#unitOfWork(async () => {
      let refunded = 0;
      for (const charge of await this.#repository.entriesFor(EntryReason.GAME, gameId)) {
        const outcome = await this.#repository.apply({ userId: charge.userId, kind: charge.kind, reason: EntryReason.REFUND, ref: gameId, delta: -charge.delta, season: charge.season, at: this.#clock.now() });
        refunded += outcome === "applied" ? 1 : 0;
      }
      if (refunded > 0) {
        this.#logger.info("entries given back for a game called off", { game: gameId, players: refunded });
      }
      return refunded;
    });
  }

  /**
   * Credits entries bought with a shop order (once per order and kind).
   * @param {{ userId: string, kind: string, count: number, orderId: string }} purchase
   * @returns {Promise<boolean>} false when that order had already credited them
   */
  async credit({ userId, kind, count, orderId }) {
    if (!this.#kinds.includes(kind) || !Number.isSafeInteger(count) || count < 1) {
      throw new Error(`cannot credit ${count} entries of kind "${kind}"`);
    }
    return (await this.#repository.apply({ userId, kind, reason: EntryReason.PURCHASE, ref: orderId, delta: count, season: null, at: this.#clock.now() })) === "applied";
  }
}

/**
 * @param {string} kind
 * @param {number} count
 */
const entryRequired = (kind, count) => new AppError("ENTRY_REQUIRED", `a ${kind} game costs ${entriesText(count, kind)}: buy them in the shop`, { kind, perGame: count });
