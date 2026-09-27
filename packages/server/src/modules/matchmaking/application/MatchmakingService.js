/**
 * MatchmakingService: the queue for online games
 * (docs/tcg/02-protocollo-multiplayer.md §3.3, queue.join / queue.leave).
 *
 * - Joining revalidates the deck (rules and ownership, T2) and freezes it
 *   in the ticket: editing or selling cards afterwards does not change the
 *   deck a game is played with.
 * - A player waits in at most one queue (unique index on WAITING tickets)
 *   and cannot queue while already playing.
 * - Pairing takes the two oldest tickets of a mode, locked with SKIP LOCKED,
 *   and creates the game in the same unit of work: two servers can never
 *   pair the same ticket twice. The match is announced only after commit.
 * - Ranked (docs/tcg/09-classificata.md): only eligible players; a ticket
 *   carries the player's rating; the oldest ticket is paired with the
 *   closest rating inside a window that widens while it waits, preferring
 *   someone it has not already played too often today.
 * - The window is a preference, not a wall: a ticket that waited longer
 *   than `relaxAfterSeconds` takes the closest opponent in the queue at any
 *   distance, and, failing that, one it already played today (that game is
 *   recorded but does not count towards ratings, T24). A small player base
 *   always finds a game instead of searching forever.
 */
import { AppError } from "../../../kernel/AppError.js";
import { uuidV4 } from "../../../kernel/random.js";

export const QueueMode = Object.freeze({ CASUAL: "casual", RANKED: "ranked" });
const MODES = Object.freeze(Object.values(QueueMode));
const RANKED_CANDIDATES = 50;
export const TicketStatus = Object.freeze({ WAITING: "WAITING", MATCHED: "MATCHED", CANCELLED: "CANCELLED", EXPIRED: "EXPIRED" });
const DEFAULT_RATING = 1000;
const MAX_PAIRS_PER_RUN = 50;

export class MatchmakingService {
  #repository;
  #decks;
  #games;
  #notifier;
  #clock;
  #random;
  #unitOfWork;
  #logger;
  #ticketTtlMs;
  #ranking;

  /**
   * @param {{
   *   repository: import("../infrastructure/PgMatchmakingRepository.js").PgMatchmakingRepository,
   *   decks: import("../../decks/index.js").DeckService,
   *   games: import("../../gameplay/index.js").GameService,
   *   notifier: import("../../gameplay/application/ports.js").GameNotifier,
   *   clock: import("../../../kernel/time.js").Clock,
   *   random: import("../../../kernel/random.js").SecureRandom,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   logger: import("../../../kernel/logger.js").Logger,
   *   ranking: import("../../ranking/index.js").RankingService,
   *   ticketTtlMs?: number,
   * }} deps
   */
  constructor({ repository, decks, games, notifier, clock, random, unitOfWork, logger, ranking, ticketTtlMs = 10 * 60 * 1000 }) {
    this.#repository = repository;
    this.#decks = decks;
    this.#games = games;
    this.#notifier = notifier;
    this.#clock = clock;
    this.#random = random;
    this.#unitOfWork = unitOfWork;
    this.#logger = logger;
    this.#ticketTtlMs = ticketTtlMs;
    this.#ranking = ranking;
  }

  /**
   * @param {{ user: { id: string, account: string }, mode: unknown, deckId: unknown }} request
   */
  async join({ user, mode: requested, deckId }) {
    const mode = MODES.find((known) => known === requested);
    if (mode === undefined) {
      throw new AppError("VALIDATION", `mode must be one of ${MODES.join(", ")}`);
    }
    if ((await this.#games.activeGameOf(user.id)) !== null) {
      throw new AppError("CONFLICT", "you are already in a game");
    }
    if (mode === QueueMode.RANKED) {
      await this.#ranking.assertEligible(user.id);
    }
    const rating = mode === QueueMode.RANKED ? Math.round((await this.#ranking.ratingOf(user.id)).rating) : DEFAULT_RATING;
    const deck = await this.#decks.playableDeckList(user.id, deckId);
    const now = this.#clock.now();
    // Re-joining the same queue (another deck, another try) keeps the moment the
    // search started: the rating window goes on widening instead of starting over.
    const waiting = await this.#repository.findWaiting(user.id);
    const since = waiting !== null && waiting.mode === mode ? waiting.createdAt : now;
    await this.#unitOfWork(async () => {
      await this.#repository.cancelWaiting(user.id, now);
      await this.#repository.insertTicket({
        id: uuidV4(this.#random),
        userId: user.id,
        account: user.account,
        mode,
        deckId: /** @type {string} */ (deckId),
        deck: deck.entries.map((entry) => [entry.cardId, entry.count]),
        rating,
        at: since,
      });
    });
    this.#notifier.send(user.id, "queue.status", { state: "searching", mode, since });
    await this.pair();
    return Object.freeze({ state: "searching", since });
  }

  /** @param {string} userId */
  async leave(userId) {
    const cancelled = await this.#repository.cancelWaiting(userId, this.#clock.now());
    if (cancelled > 0) {
      this.#notifier.send(userId, "queue.status", { state: "idle" });
    }
    return cancelled > 0;
  }

  /** @param {string} userId */
  async status(userId) {
    const ticket = await this.#repository.findWaiting(userId);
    return ticket === null ? Object.freeze({ state: "idle" }) : Object.freeze({ state: "searching", mode: ticket.mode, since: ticket.createdAt });
  }

  /**
   * Pairs waiting players, oldest first, until fewer than two wait in a mode.
   * @returns {Promise<number>} games created
   */
  async pair() {
    let created = 0;
    for (const mode of MODES) {
      created += await this.#pairMode(mode);
    }
    return created;
  }

  /** @param {string} mode */
  async #pairMode(mode) {
    let created = 0;
    for (let run = 0; run < MAX_PAIRS_PER_RUN; run += 1) {
      const staged = await this.#unitOfWork(async () => {
        const tickets = mode === QueueMode.RANKED ? await this.#rankedPair() : await this.#repository.lockOldestPair(mode);
        if (tickets === null || tickets.length < 2) {
          return null;
        }
        const game = await this.#games.stageGame({ mode, entrants: tickets.map((ticket) => ({ userId: ticket.userId, account: ticket.account, deckId: ticket.deckId, deck: ticket.deck.map(([cardId, count]) => ({ cardId, count })) })) });
        await this.#repository.markMatched(tickets.map((ticket) => ticket.id), game.game.id, this.#clock.now());
        return game;
      });
      if (staged === null) {
        return created;
      }
      this.#games.launchGame(staged);
      this.#logger.info("match made", { game: staged.game.id, mode });
      created += 1;
    }
    return created;
  }

  /**
   * The oldest ranked ticket that has an acceptable opponent, with the closest one.
   *
   * Two passes over the waiting tickets, oldest first. The strict pass keeps
   * the rating window and the daily limit between the same two players. The
   * relaxed pass only looks at tickets that waited longer than
   * `relaxAfterSeconds`: for those the window is dropped (the closest
   * opponent in the queue wins, however far) and, as a last resort, so is the
   * daily limit, because a game that does not count beats no game at all.
   * @returns {Promise<readonly any[] | null>}
   */
  async #rankedPair() {
    const tickets = await this.#repository.lockWaiting(QueueMode.RANKED, RANKED_CANDIDATES);
    if (tickets.length < 2) {
      return null;
    }
    const { baseWindow, windowPerSecond, maxWindow, relaxAfterSeconds } = this.#ranking.settings.matchmaking;
    const now = this.#clock.now();
    for (const relaxed of [false, true]) {
      for (const anchor of tickets) {
        const waited = (now - anchor.createdAt) / 1000;
        if (relaxed && waited < relaxAfterSeconds) {
          continue;
        }
        const window = relaxed ? Number.POSITIVE_INFINITY : Math.min(maxWindow, baseWindow + windowPerSecond * waited);
        const opponent = await this.#opponentFor(anchor, tickets, window, relaxed);
        if (opponent !== null) {
          return [anchor, opponent];
        }
      }
    }
    return null;
  }

  /**
   * The closest rating to `anchor` inside `window` that may still play a
   * counted game against it, or, when `orElseAnyone`, simply the closest one.
   * @param {any} anchor
   * @param {readonly any[]} tickets
   * @param {number} window
   * @param {boolean} orElseAnyone
   * @returns {Promise<any | null>}
   */
  async #opponentFor(anchor, tickets, window, orElseAnyone) {
    const candidates = tickets
      .filter((other) => other.userId !== anchor.userId && Math.abs(other.rating - anchor.rating) <= window)
      .sort((left, right) => Math.abs(left.rating - anchor.rating) - Math.abs(right.rating - anchor.rating));
    for (const candidate of candidates) {
      if (await this.#ranking.pairAllowed(anchor.userId, candidate.userId)) {
        return candidate;
      }
    }
    if (orElseAnyone && candidates.length > 0) {
      this.#logger.info("ranked pair over the daily limit", { anchor: anchor.userId, opponent: candidates[0].userId });
      return candidates[0];
    }
    return null;
  }

  /** Drops tickets that waited too long. */
  async expireStale() {
    return this.#repository.expireOlderThan(this.#clock.now() - this.#ticketTtlMs, this.#clock.now());
  }
}
