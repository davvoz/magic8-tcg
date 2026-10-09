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
 * - Ranked (docs/tcg/09-classificata.md): only eligible players, and one
 *   pairing rule: two players who played their rated games of the day
 *   together (T24) are not paired again until they may. The oldest ticket
 *   plays the oldest one it may play, whatever their ratings; when nobody
 *   waiting may be paired, those held apart are told who with, why, and
 *   for how long (once per search).
 * - Direct games (a challenge accepted in the lobby) skip the queue but
 *   are created here too, under the same rule: one game per player.
 * - Paid modes (ranked, when the season charges an entry fee: docs/tcg/22):
 *   joining needs the entries a game costs, and the game takes them from
 *   both players in the unit of work that creates it. A paired player whose
 *   entries ran out meanwhile leaves the queue (and is told) instead of
 *   blocking it.
 */
import { AppError } from "../../../kernel/AppError.js";
import { uuidV4 } from "../../../kernel/random.js";

export const QueueMode = Object.freeze({ CASUAL: "casual", RANKED: "ranked" });
const MODES = Object.freeze(Object.values(QueueMode));
export const TicketStatus = Object.freeze({ WAITING: "WAITING", MATCHED: "MATCHED", CANCELLED: "CANCELLED", EXPIRED: "EXPIRED" });
const DEFAULT_RATING = 1000;
const MAX_PAIRS_PER_RUN = 50;
/** Ranked tickets looked at for a pair: past the oldest, whoever the oldest may play. */
const RANKED_CANDIDATES = 20;
/**
 * @typedef {Awaited<ReturnType<import("../infrastructure/PgMatchmakingRepository.js").PgMatchmakingRepository["lockOldest"]>>[number]} Ticket
 * @typedef {Readonly<{ userId: string, ticketId: string, mode: string, since: number, opponent: string, nextAt: number }>} HeldApart a ranked player
 *   waiting with nobody they may play: the opponent they may play again the soonest, and when
 */

/** @param {string} first @param {string} second */
const pairKey = (first, second) => (first < second ? `${first}|${second}` : `${second}|${first}`);

/** Entries when every mode is free. */
const FREE_ENTRIES = Object.freeze({ assertCanEnter: async () => undefined, shortOf: async () => Object.freeze([]), charge: async () => 0 });

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
  #entries;
  #gate;
  /** user → the search and opponent they were last told they are held apart from (told once per search). @type {Map<string, string>} */
  #heldApartTold = new Map();

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
   *   entries?: Pick<import("../../entries/index.js").EntryService, "assertCanEnter" | "shortOf" | "charge">,
   *   ticketTtlMs?: number,
   *   gate?: { assertOpen: (what: string) => void, isClosed: () => boolean },
   * }} deps `entries`: what paid modes cost (by default every mode is free); `gate`: closed during an announced maintenance (no new games)
   */
  constructor({ repository, decks, games, notifier, clock, random, unitOfWork, logger, ranking, entries = FREE_ENTRIES, ticketTtlMs = 10 * 60 * 1000, gate = { assertOpen: () => undefined, isClosed: () => false } }) {
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
    this.#entries = entries;
    this.#gate = gate;
  }

  /**
   * @param {{ user: { id: string, account: string }, mode: unknown, deckId: unknown }} request
   */
  async join({ user, mode: requested, deckId }) {
    const mode = MODES.find((known) => known === requested);
    if (mode === undefined) {
      throw new AppError("VALIDATION", `mode must be one of ${MODES.join(", ")}`);
    }
    this.#gate.assertOpen("Matchmaking");
    if ((await this.#games.activeGameOf(user.id)) !== null) {
      throw new AppError("CONFLICT", "you are already in a game");
    }
    if (mode === QueueMode.RANKED) {
      await this.#ranking.assertEligible(user.id);
    }
    await this.#entries.assertCanEnter(user.id, mode);
    const rating = mode === QueueMode.RANKED ? Math.round((await this.#ranking.ratingOf(user.id)).rating) : DEFAULT_RATING;
    const deck = await this.#decks.playableDeckList(user.id, deckId);
    const now = this.#clock.now();
    // Re-joining the same queue (another deck, another try) keeps the moment the
    // search started, and with it the place in the queue.
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

  /** The users waiting in a queue now. */
  async waitingUsers() {
    return new Set(await this.#repository.waitingUsers());
  }

  /**
   * A game between two chosen players, with no queue (a challenge accepted,
   * the lobby module). Their waiting tickets are cancelled in the same unit
   * of work as the game is created: a ticket the pairing holds makes the
   * cancel wait for it, and a game it gave either player meanwhile makes
   * this one fail, so nobody ends up in two games. A paid mode takes its fee
   * in the same unit of work: a player without the entries fails it. Decks
   * were validated by the caller (and frozen when each player chose theirs).
   * @param {{ mode: unknown, entrants: readonly Readonly<{ userId: string, account: string, deckId: string, deck: readonly Readonly<{ cardId: string, count: number }>[] }>[] }} request
   * @returns {Promise<string>} the game's id
   */
  async startDirect({ mode: requested, entrants }) {
    const mode = MODES.find((known) => known === requested);
    if (mode === undefined) {
      throw new AppError("VALIDATION", `mode must be one of ${MODES.join(", ")}`);
    }
    this.#gate.assertOpen("Matchmaking");
    const now = this.#clock.now();
    const { staged, unqueued } = await this.#unitOfWork(async () => {
      const cancelled = [];
      for (const entrant of entrants) {
        if ((await this.#repository.cancelWaiting(entrant.userId, now)) > 0) {
          cancelled.push(entrant.userId);
        }
      }
      for (const entrant of entrants) {
        if ((await this.#games.activeGameOf(entrant.userId)) !== null) {
          throw new AppError("CONFLICT", `@${entrant.account} is already in a game`);
        }
      }
      const game = await this.#games.stageGame({ mode, entrants });
      await this.#entries.charge({ gameId: game.game.id, mode, userIds: entrants.map((entrant) => entrant.userId) });
      return { staged: game, unqueued: cancelled };
    });
    for (const userId of unqueued) {
      this.#notifier.send(userId, "queue.status", { state: "idle" });
    }
    this.#games.launchGame(staged);
    this.#logger.info("direct game made", { game: staged.game.id, mode });
    return staged.game.id;
  }

  /**
   * Pairs waiting players, oldest first, until fewer than two wait in a mode.
   * @returns {Promise<number>} games created
   */
  async pair() {
    if (this.#gate.isClosed()) {
      return 0;
    }
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
      const outcome = await this.#unitOfWork(() => this.#pairOldest(mode));
      if (outcome === null) {
        return created;
      }
      if ("heldApart" in outcome) {
        this.#tellHeldApart(outcome.heldApart);
        return created;
      }
      if (outcome.staged === null) {
        for (const userId of outcome.dropped) {
          this.#notifier.send(userId, "queue.status", { state: "idle", reason: "entries" });
        }
        this.#logger.info("players without entries left the queue", { mode, players: outcome.dropped.length });
        continue;
      }
      this.#games.launchGame(outcome.staged);
      this.#logger.info("match made", { game: outcome.staged.game.id, mode });
      created += 1;
    }
    return created;
  }

  /**
   * Inside a unit of work: the two oldest tickets of a mode that may play each other become a game (its fee taken
   * from both), or the players among them who can no longer pay leave the queue; null when fewer than two wait, and
   * the pairs held apart when none of those waiting may play each other.
   * @param {string} mode
   * @returns {Promise<{ staged: Awaited<ReturnType<import("../../gameplay/index.js").GameService["stageGame"]>>, dropped: readonly string[] } | { staged: null, dropped: readonly string[] } | { heldApart: readonly HeldApart[] } | null>}
   */
  async #pairOldest(mode) {
    const waiting = await this.#repository.lockOldest(mode, mode === QueueMode.RANKED ? RANKED_CANDIDATES : 2);
    if (waiting.length < 2) {
      return null;
    }
    const { tickets, heldApart } = mode === QueueMode.RANKED ? await this.#rankedPair(waiting) : { tickets: waiting, heldApart: [] };
    if (tickets === null) {
      return { heldApart };
    }
    const userIds = tickets.map((ticket) => ticket.userId);
    const short = await this.#entries.shortOf(userIds, mode);
    if (short.length > 0) {
      for (const userId of short) {
        await this.#repository.cancelWaiting(userId, this.#clock.now());
      }
      return { staged: null, dropped: short };
    }
    const staged = await this.#games.stageGame({ mode, entrants: tickets.map((ticket) => ({ userId: ticket.userId, account: ticket.account, deckId: ticket.deckId, deck: ticket.deck.map(([cardId, count]) => ({ cardId, count })) })) });
    await this.#entries.charge({ gameId: staged.game.id, mode, userIds });
    await this.#repository.markMatched(tickets.map((ticket) => ticket.id), staged.game.id, this.#clock.now());
    return { staged, dropped: Object.freeze([]) };
  }

  /**
   * The oldest ranked ticket with the oldest one its player may play (T24), else, when no two may play each
   * other, each waiting player with the opponent they may play again the soonest.
   * @param {readonly Ticket[]} waiting oldest first
   * @returns {Promise<{ tickets: readonly Ticket[], heldApart: readonly HeldApart[] } | { tickets: null, heldApart: readonly HeldApart[] }>}
   */
  async #rankedPair(waiting) {
    const limited = await this.#ranking.pairsAtLimit(waiting.map((ticket) => ticket.userId));
    const nextAt = new Map(limited.map((pair) => [pairKey(...pair.userIds), pair.nextAt]));
    for (const [index, first] of waiting.entries()) {
      const second = waiting.slice(index + 1).find((other) => !nextAt.has(pairKey(first.userId, other.userId)));
      if (second !== undefined) {
        return { tickets: [first, second], heldApart: [] };
      }
    }
    const heldApart = waiting.map((ticket) => {
      const [soonest] = waiting
        .filter((other) => other !== ticket)
        .map((other) => ({ opponent: other.account, nextAt: /** @type {number} */ (nextAt.get(pairKey(ticket.userId, other.userId))) }))
        .sort((left, right) => left.nextAt - right.nextAt);
      return Object.freeze({ userId: ticket.userId, ticketId: ticket.id, mode: ticket.mode, since: ticket.createdAt, ...soonest });
    });
    return { tickets: null, heldApart };
  }

  /**
   * Tells players the queue holds apart from everyone waiting who with, why, and for how long; once per search and opponent.
   * @param {readonly HeldApart[]} heldApart
   */
  #tellHeldApart(heldApart) {
    for (const { userId, ticketId, mode, since, opponent, nextAt } of heldApart) {
      const told = `${ticketId}:${opponent}`;
      if (this.#heldApartTold.get(userId) === told) {
        continue;
      }
      this.#heldApartTold.set(userId, told);
      const message = this.#ranking.heldApartText(opponent, nextAt);
      this.#notifier.send(userId, "queue.status", { state: "searching", mode, since, reason: "pair_limit", opponent, nextAt, message });
    }
  }

  /**
   * A maintenance was announced: everyone waiting leaves the queue, and is told.
   * @returns {Promise<number>} tickets cancelled
   */
  async closeQueue() {
    const userIds = await this.#repository.cancelAllWaiting(this.#clock.now());
    for (const userId of new Set(userIds)) {
      this.#notifier.send(userId, "queue.status", { state: "idle", reason: "maintenance" });
    }
    return userIds.length;
  }

  /** Drops tickets that waited too long. */
  async expireStale() {
    return this.#repository.expireOlderThan(this.#clock.now() - this.#ticketTtlMs, this.#clock.now());
  }
}
