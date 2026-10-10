/**
 * AutoService: the auto list of ranked play (docs/tcg/23-automatica.md).
 *
 * - A player prepares a ticket (`prepare`): the server makes the ticket's
 *   secret and tells them only its commitment. Then they join (`join`) with a
 *   deck, an AI style and their entropy: the secret was fixed before the
 *   entropy, so neither side chose what the two make. Joining takes the
 *   entry of a ranked game at once, and there is no leaving the list.
 * - The same players may join as may play ranked (a season running, the
 *   casual games), with one ticket each at a time; deck and style are frozen
 *   in the ticket like a queue ticket's deck.
 * - The two oldest tickets of the running season whose players may still
 *   play an auto game together today (the daily limit per pair, counted
 *   apart from ranked games by hand) become a game, in one unit of work: the
 *   gameplay module plays it to its end with the AI and stores it finished,
 *   the tickets are matched, the ratings move (by the auto weight), and both
 *   players get a notification. The game's secret is the hash of the two
 *   tickets' secrets (autoGameSecret); the older ticket sits at s0.
 * - Pairing runs when someone joins and on a timer (a pair limit that ran
 *   out). An announced maintenance pauses it; tickets stay.
 * - When the season of a waiting ticket ends, the ticket closes and its
 *   entry goes back. A game that cannot be played (a bug) closes both
 *   tickets the same way, so one broken pair never blocks the list.
 */
import { AI_VERSION } from "@magic8/engine/domain/ai/BasicAi.js";
import { autoGameSecret, bytesToHex, seedCommitment } from "@magic8/protocol";
import { AppError } from "../../../kernel/AppError.js";
import { uuidV4 } from "../../../kernel/random.js";
import { AUTO_STYLES, AutoCloseReason, AutoTicketStatus, ENTROPY_PATTERN } from "../domain/AutoTicket.js";

/** The kind of entry an auto ticket pays with: the same entries as a ranked game by hand. */
const ENTRY_KIND = "ranked";
/** The mode of the games the list makes. */
const AUTO_MODE = "auto";
const SECRET_BYTES = 32;
const HOUR_MS = 60 * 60 * 1000;
/** Tickets a player may prepare in an hour (each `prepare` writes a row). */
const MAX_PREPARED_PER_HOUR = 30;
/** Waiting tickets looked at for a pair: past the oldest, whoever the oldest may play. */
const CANDIDATES = 20;
/** Games one pairing run may make. */
const MAX_GAMES_PER_RUN = 50;
/** A prepared ticket nobody joined with is forgotten after this long. */
const PREPARED_TTL_MS = 24 * HOUR_MS;

/**
 * @typedef {import("../infrastructure/PgAutoRepository.js").StoredTicket} StoredTicket
 * @typedef {import("../../gameplay/application/ports.js").FinishedGame} FinishedGame
 */

/** A pair whose game could not be played: both tickets close and give their entry back. */
class UnplayablePair extends Error {
  /**
   * @param {readonly StoredTicket[]} tickets
   * @param {unknown} cause
   */
  constructor(tickets, cause) {
    super(`auto game could not be played: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.tickets = tickets;
  }
}

export class AutoService {
  #repository;
  #decks;
  #games;
  #ranking;
  #entries;
  #notifications;
  #notifier;
  #secrets;
  #clock;
  #random;
  #unitOfWork;
  #logger;
  #gate;

  /**
   * @param {{
   *   repository: import("../infrastructure/PgAutoRepository.js").PgAutoRepository,
   *   decks: Pick<import("../../decks/index.js").DeckService, "playableDeckList">,
   *   games: Pick<import("../../gameplay/index.js").GameService, "playAutoGame" | "announceFinished" | "finishedGame">,
   *   ranking: Pick<import("../../ranking/index.js").RankingService, "assertEligible" | "currentSeason" | "pairsAtLimit" | "record" | "changeOf">,
   *   entries: Pick<import("../../entries/index.js").EntryService, "chargeTicket" | "refundTicket">,
   *   notifications: Pick<import("../../notifications/index.js").NotificationService, "notify">,
   *   notifier: import("../../gameplay/application/ports.js").GameNotifier,
   *   secrets: import("../../../kernel/crypto/SecretBox.js").SecretBox,
   *   clock: import("../../../kernel/time.js").Clock,
   *   random: import("../../../kernel/random.js").SecureRandom,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   logger: import("../../../kernel/logger.js").Logger,
   *   gate?: { assertOpen: (what: string) => void, isClosed: () => boolean },
   * }} deps `gate`: closed during an announced maintenance (no new tickets, no new games)
   */
  constructor({ repository, decks, games, ranking, entries, notifications, notifier, secrets, clock, random, unitOfWork, logger, gate = { assertOpen: () => undefined, isClosed: () => false } }) {
    this.#repository = repository;
    this.#decks = decks;
    this.#games = games;
    this.#ranking = ranking;
    this.#entries = entries;
    this.#notifications = notifications;
    this.#notifier = notifier;
    this.#secrets = secrets;
    this.#clock = clock;
    this.#random = random;
    this.#unitOfWork = unitOfWork;
    this.#logger = logger;
    this.#gate = gate;
  }

  /**
   * Makes a ticket's secret and returns its commitment: the player joins with that ticket and their entropy.
   * @param {{ id: string, account: string }} user
   * @returns {Promise<Readonly<{ ticket: string, commit: string }>>}
   */
  async prepare(user) {
    this.#gate.assertOpen("The auto list");
    const now = this.#clock.now();
    if ((await this.#repository.countPrepared(user.id, now - HOUR_MS)) >= MAX_PREPARED_PER_HOUR) {
      throw new AppError("RATE_LIMITED", "too many auto tickets prepared: try again later");
    }
    const id = uuidV4(this.#random);
    const secret = this.#random.bytes(SECRET_BYTES);
    const commit = seedCommitment(bytesToHex(secret));
    await this.#repository.insertPrepared({ id, userId: user.id, account: user.account, sealedSecret: this.#secrets.seal(secret, secretContext(id)), commit, at: now });
    return Object.freeze({ ticket: id, commit });
  }

  /**
   * Joins the auto list with a prepared ticket, paying the entry; then pairs whoever can be paired.
   * @param {{ user: { id: string, account: string }, ticket: string, deckId: string, style: string, entropy: string }} request
   */
  async join({ user, ticket, deckId, style, entropy }) {
    if (!AUTO_STYLES.some((known) => known === style)) {
      throw new AppError("VALIDATION", `style must be one of ${AUTO_STYLES.join(", ")}`);
    }
    if (!ENTROPY_PATTERN.test(entropy)) {
      throw new AppError("VALIDATION", "entropy must be 16 bytes as lowercase hex");
    }
    this.#gate.assertOpen("The auto list");
    await this.#ranking.assertEligible(user.id);
    const season = this.#ranking.currentSeason();
    if (season === null) {
      throw new AppError("CONFLICT", "no ranked season is running");
    }
    const deck = await this.#decks.playableDeckList(user.id, deckId);
    const now = this.#clock.now();
    await this.#unitOfWork(async () => {
      if ((await this.#repository.findWaiting(user.id)) !== null) {
        throw new AppError("CONFLICT", "you are already in the auto list");
      }
      const prepared = await this.#repository.lockPrepared(ticket, user.id);
      if (prepared === null) {
        throw new AppError("NOT_FOUND", "no such auto ticket: prepare a new one");
      }
      const paid = await this.#entries.chargeTicket({ ticketId: prepared.id, userId: user.id, mode: ENTRY_KIND });
      await this.#repository.markWaiting({ id: prepared.id, season: season.id, style, deckId, deck: deck.entries.map((entry) => [entry.cardId, entry.count]), entropy, entries: paid.count, at: now });
    });
    this.#logger.info("joined the auto list", { ticket, style });
    const status = await this.status(user.id);
    this.#notifier.send(user.id, "auto.status", status);
    // The ticket is in the list whatever happens next: a pairing that fails is retried by the timer.
    await this.pair().catch((error) => this.#logger.error("auto pairing failed", { error: error instanceof Error ? error.message : String(error) }));
    return this.status(user.id);
  }

  /**
   * A player's place in the auto list, and how many tickets wait in it.
   * @param {string} userId
   */
  async status(userId) {
    const [ticket, waiting] = [await this.#repository.findWaiting(userId), await this.#repository.countWaiting()];
    if (ticket === null) {
      return Object.freeze({ state: "idle", waiting });
    }
    return Object.freeze({ state: "waiting", waiting, ticket: ticket.id, since: ticket.joinedAt, deckId: ticket.deckId, style: ticket.style, entries: ticket.entries, commit: ticket.commit });
  }

  /**
   * Plays the games the list can make now, oldest tickets first.
   * @returns {Promise<number>} games played
   */
  async pair() {
    const season = this.#ranking.currentSeason();
    if (this.#gate.isClosed() || season === null) {
      return 0;
    }
    let played = 0;
    for (let run = 0; run < MAX_GAMES_PER_RUN; run += 1) {
      let outcome;
      try {
        outcome = await this.#unitOfWork(() => this.#playOldest(season.id));
      } catch (error) {
        if (!(error instanceof UnplayablePair)) {
          throw error;
        }
        this.#logger.error(error.message, { tickets: error.tickets.map((ticket) => ticket.id) });
        await this.#closeTickets(error.tickets, AutoTicketStatus.FAILED, AutoCloseReason.FAILED);
        continue;
      }
      if (outcome === null) {
        return played;
      }
      this.#announce(outcome);
      played += 1;
    }
    return played;
  }

  /**
   * Closes the waiting tickets whose season is over, giving their entries back.
   * @returns {Promise<number>} tickets closed
   */
  async closeEnded() {
    const season = this.#ranking.currentSeason();
    const ended = await this.#repository.listWaitingOutside(season?.id ?? null);
    return this.#closeTickets(ended, AutoTicketStatus.REFUNDED, AutoCloseReason.SEASON_ENDED);
  }

  /** Forgets tickets prepared long ago and never joined. */
  purgePrepared() {
    return this.#repository.deletePreparedBefore(this.#clock.now() - PREPARED_TTL_MS);
  }

  /**
   * An auto game as anyone may replay and check it: the game's events, each seat's style, and each ticket's secret
   * with the commitment its player was given and their entropy. Null when it is not a finished auto game.
   * @param {string} gameId
   */
  async replay(gameId) {
    const game = await this.#games.finishedGame(gameId);
    if (game === null || game.mode !== AUTO_MODE) {
      return null;
    }
    const tickets = await this.#repository.ticketsOfGame(gameId);
    return Object.freeze({
      ...game,
      aiVersion: tickets[0]?.aiVersion ?? null,
      tickets: Object.freeze(
        tickets.map((ticket) =>
          Object.freeze({ seat: ticket.seat, account: ticket.account, style: ticket.style, commit: ticket.commit, secret: bytesToHex(this.#secrets.open(ticket.sealedSecret, secretContext(ticket.id))), entropy: ticket.entropy }),
        ),
      ),
    });
  }

  /**
   * Inside a unit of work: the oldest two tickets of the season whose players may play each other, played as a
   * game; null when no two may.
   * @param {string} season
   * @returns {Promise<{ summary: FinishedGame, tickets: readonly StoredTicket[] } | null>}
   */
  async #playOldest(season) {
    const waiting = await this.#repository.lockOldest(season, CANDIDATES);
    if (waiting.length < 2) {
      return null;
    }
    const tickets = await this.#firstPair(waiting);
    if (tickets === null) {
      return null;
    }
    let summary;
    try {
      summary = await this.#games.playAutoGame({
        entrants: tickets.map((ticket) => ({ userId: ticket.userId, account: ticket.account, deckId: ticket.deckId, deck: (ticket.deck ?? []).map(([cardId, count]) => ({ cardId, count })) })),
        styles: tickets.map((ticket) => /** @type {string} */ (ticket.style)),
        secret: autoGameSecret(tickets.map((ticket) => bytesToHex(this.#secrets.open(ticket.sealedSecret, secretContext(ticket.id))))),
        entropies: tickets.map((ticket) => /** @type {string} */ (ticket.entropy)),
      });
    } catch (error) {
      throw new UnplayablePair(tickets, error);
    }
    const now = this.#clock.now();
    for (const [index, ticket] of tickets.entries()) {
      await this.#repository.markMatched({ id: ticket.id, gameId: summary.gameId, seat: summary.players[index].seat, aiVersion: AI_VERSION, at: now });
    }
    await this.#ranking.record(summary);
    for (const [index, ticket] of tickets.entries()) {
      const opponent = tickets[1 - index];
      await this.#notifications.notify(ticket.userId, "auto.finished", await this.#resultFor(summary, ticket, opponent));
    }
    return { summary, tickets };
  }

  /**
   * The oldest ticket with the oldest one its player may play an auto game with today, or null.
   * @param {readonly StoredTicket[]} waiting oldest first
   * @returns {Promise<readonly StoredTicket[] | null>}
   */
  async #firstPair(waiting) {
    const limited = await this.#ranking.pairsAtLimit(waiting.map((ticket) => ticket.userId), AUTO_MODE);
    const held = new Set(limited.map((pair) => pairKey(...pair.userIds)));
    for (const [index, first] of waiting.entries()) {
      const second = waiting.slice(index + 1).find((other) => other.userId !== first.userId && !held.has(pairKey(first.userId, other.userId)));
      if (second !== undefined) {
        return Object.freeze([first, second]);
      }
    }
    return null;
  }

  /**
   * What a player hears about their auto game.
   * @param {FinishedGame} summary
   * @param {StoredTicket} ticket
   * @param {StoredTicket} opponent
   */
  async #resultFor(summary, ticket, opponent) {
    const seat = summary.players.find((player) => player.userId === ticket.userId)?.seat ?? null;
    const change = await this.#ranking.changeOf(summary.gameId, ticket.userId);
    return {
      gameId: summary.gameId,
      opponent: opponent.account,
      result: resultOf(seat, summary.winnerSeat),
      style: ticket.style,
      opponentStyle: opponent.style,
      rating: change === null || !change.counted ? null : { before: change.before, after: change.after },
    };
  }

  /**
   * After a game's unit of work committed: the finished-game listeners, and both players if they are connected.
   * @param {{ summary: FinishedGame, tickets: readonly StoredTicket[] }} outcome
   */
  #announce({ summary, tickets }) {
    this.#games.announceFinished(summary);
    this.#logger.info("auto game played", { game: summary.gameId, winner: summary.winnerSeat, reason: summary.endReason, turns: summary.turn });
    for (const ticket of tickets) {
      this.#notifier.send(ticket.userId, "auto.status", { state: "idle", game: summary.gameId });
    }
  }

  /**
   * Closes waiting tickets that will never be a game, each in its own unit of work, giving their entries back.
   * @param {readonly StoredTicket[]} tickets
   * @param {"REFUNDED" | "FAILED"} status
   * @param {string} reason
   * @returns {Promise<number>} tickets closed
   */
  async #closeTickets(tickets, status, reason) {
    let closed = 0;
    for (const ticket of tickets) {
      const entries = await this.#unitOfWork(async () => {
        if (!(await this.#repository.close(ticket.id, status, this.#clock.now()))) {
          return null;
        }
        const refunded = await this.#entries.refundTicket(ticket.id);
        await this.#notifications.notify(ticket.userId, "auto.refunded", { ticket: ticket.id, entries: refunded, reason });
        return refunded;
      });
      if (entries !== null) {
        closed += 1;
        this.#logger.info("auto ticket closed without a game", { ticket: ticket.id, reason, entries });
        this.#notifier.send(ticket.userId, "auto.status", { state: "idle", reason });
      }
    }
    return closed;
  }
}

/** @param {string} id */
const secretContext = (id) => `auto-ticket:${id}`;

/** @param {string} first @param {string} second */
const pairKey = (first, second) => (first < second ? `${first}|${second}` : `${second}|${first}`);

/**
 * @param {string | null} seat
 * @param {string | null} winner null for a draw
 */
const resultOf = (seat, winner) => {
  if (winner === null) {
    return "draw";
  }
  return seat === winner ? "win" : "loss";
};
