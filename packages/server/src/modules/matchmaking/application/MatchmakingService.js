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
 */
import { AppError } from "../../../kernel/AppError.js";
import { uuidV4 } from "../../../kernel/random.js";

export const QueueMode = Object.freeze({ CASUAL: "casual" });
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
   *   ticketTtlMs?: number,
   * }} deps
   */
  constructor({ repository, decks, games, notifier, clock, random, unitOfWork, logger, ticketTtlMs = 10 * 60 * 1000 }) {
    this.#repository = repository;
    this.#decks = decks;
    this.#games = games;
    this.#notifier = notifier;
    this.#clock = clock;
    this.#random = random;
    this.#unitOfWork = unitOfWork;
    this.#logger = logger;
    this.#ticketTtlMs = ticketTtlMs;
  }

  /**
   * @param {{ user: { id: string, account: string }, mode: unknown, deckId: unknown }} request
   */
  async join({ user, mode, deckId }) {
    if (mode !== QueueMode.CASUAL) {
      throw new AppError("VALIDATION", "only casual games are available");
    }
    if ((await this.#games.activeGameOf(user.id)) !== null) {
      throw new AppError("CONFLICT", "you are already in a game");
    }
    const deck = await this.#decks.playableDeckList(user.id, deckId);
    const now = this.#clock.now();
    await this.#unitOfWork(async () => {
      // A new ticket replaces a waiting one (another deck, another try).
      await this.#repository.cancelWaiting(user.id, now);
      await this.#repository.insertTicket({
        id: uuidV4(this.#random),
        userId: user.id,
        account: user.account,
        mode,
        deckId: /** @type {string} */ (deckId),
        deck: deck.entries.map((entry) => [entry.cardId, entry.count]),
        rating: DEFAULT_RATING,
        at: now,
      });
    });
    this.#notifier.send(user.id, "queue.status", { state: "searching", mode, since: now });
    await this.pair();
    return Object.freeze({ state: "searching", since: now });
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
    for (let run = 0; run < MAX_PAIRS_PER_RUN; run += 1) {
      const staged = await this.#unitOfWork(async () => {
        const tickets = await this.#repository.lockOldestPair(QueueMode.CASUAL);
        if (tickets.length < 2) {
          return null;
        }
        const game = await this.#games.stageGame({ mode: QueueMode.CASUAL, entrants: tickets.map((ticket) => ({ userId: ticket.userId, account: ticket.account, deckId: ticket.deckId, deck: ticket.deck.map(([cardId, count]) => ({ cardId, count })) })) });
        await this.#repository.markMatched(tickets.map((ticket) => ticket.id), game.game.id, this.#clock.now());
        return game;
      });
      if (staged === null) {
        return created;
      }
      this.#games.launchGame(staged);
      this.#logger.info("match made", { game: staged.game.id });
      created += 1;
    }
    return created;
  }

  /** Drops tickets that waited too long. */
  async expireStale() {
    return this.#repository.expireOlderThan(this.#clock.now() - this.#ticketTtlMs, this.#clock.now());
  }
}
