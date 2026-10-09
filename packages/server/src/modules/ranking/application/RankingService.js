/**
 * RankingService: ratings of ranked games (docs/tcg/09-classificata.md).
 *
 * - A finished ranked game updates both players' Glicko-2 ratings once
 *   (rating_changes is keyed by game and player, and append-only), from
 *   their ratings before the game, in the season the game ended in.
 * - Fair play (T24): past a few rated games between the same two players
 *   in a 24-hour window, ranked play between them is refused until the
 *   oldest of those games leaves the window (the queue does not pair them, a
 *   challenge is refused, both told when they may again). A game that gets
 *   through anyway (a race, a game created elsewhere) is recorded but
 *   changes nothing, and is flagged. Repeated quick concessions between the
 *   same players are flagged for an operator. Ratings carry no market value
 *   in v1, so flags inform, they do not punish.
 * - Results arrive from the gameplay module right after a game ends; a
 *   periodic catch-up records any game that was missed (a restart, a failed
 *   write). Recording is idempotent, so both paths can see the same game.
 */
import { AppError } from "../../../kernel/AppError.js";
import { DEFAULT_RATING, rateGame } from "../domain/Glicko2.js";
import { seasonAt } from "../domain/RankedSettings.js";

export const RANKED = "ranked";
const CASUAL = "casual";
const DAY_MS = 24 * 60 * 60 * 1000;
const CATCH_UP_WINDOW_MS = 2 * DAY_MS;
const LEADERBOARD_SIZE = 100;
/** A rating is provisional (listed, but with no rank yet) until this many rated games. */
export const SETTLED_GAMES = 3;

/**
 * @typedef {import("../infrastructure/PgRankingRepository.js").StoredRating} StoredRating
 * @typedef {import("../../gameplay/application/ports.js").FinishedGame} FinishedGame
 */

/**
 * @param {string | null} winnerSeat null for a draw
 * @param {string} seat
 * @returns {0 | 0.5 | 1}
 */
const scoreOf = (winnerSeat, seat) => {
  if (winnerSeat === null) {
    return 0.5;
  }
  return winnerSeat === seat ? 1 : 0;
};

/**
 * @param {number} milliseconds
 * @returns {string} "4h 05m", or "12m" under an hour (never less than a minute)
 */
const waitText = (milliseconds) => {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`;
};

export class RankingService {
  #repository;
  #settings;
  #games;
  #clock;
  #unitOfWork;
  #logger;

  /**
   * @param {{
   *   repository: import("../infrastructure/PgRankingRepository.js").PgRankingRepository,
   *   settings: import("../domain/RankedSettings.js").RankedSettings,
   *   games: { finishedGames: (query: { mode: string, since: number }) => Promise<readonly FinishedGame[]>, countFinished: (userId: string, mode: string) => Promise<number> },
   *   clock: import("../../../kernel/time.js").Clock,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   logger: import("../../../kernel/logger.js").Logger,
   * }} deps
   */
  constructor({ repository, settings, games, clock, unitOfWork, logger }) {
    this.#repository = repository;
    this.#settings = settings;
    this.#games = games;
    this.#clock = clock;
    this.#unitOfWork = unitOfWork;
    this.#logger = logger;
  }

  get settings() {
    return this.#settings;
  }

  /** The season running now (or null before the first). */
  currentSeason() {
    return seasonAt(this.#settings, this.#clock.now());
  }

  /**
   * What a game of `mode` costs now, in entries: a ranked game, the running season's fee; null when it is free.
   * @param {string} mode
   * @returns {Readonly<{ count: number, season: string }> | null}
   */
  entryFeeOf(mode) {
    const season = mode === RANKED ? this.currentSeason() : null;
    return season === null || season.entryFee === 0 ? null : Object.freeze({ count: season.entryFee, season: season.id });
  }

  /**
   * A player's rating this season (the starting one before any ranked game).
   * @param {string} userId
   */
  async ratingOf(userId) {
    const season = this.currentSeason();
    const stored = season === null ? null : await this.#repository.find(season.id, userId);
    return stored ?? Object.freeze({ season: season?.id ?? null, userId, rating: DEFAULT_RATING.rating, rd: DEFAULT_RATING.rd, volatility: DEFAULT_RATING.volatility, games: 0, wins: 0, losses: 0, draws: 0 });
  }

  /**
   * Refuses ranked play before a season starts, or to a player who has not finished enough casual games (T24: fresh accounts farming ratings).
   * @param {string} userId
   */
  async assertEligible(userId) {
    if (this.currentSeason() === null) {
      throw new AppError("CONFLICT", "no ranked season is running");
    }
    const required = this.#settings.eligibility.minFinishedCasualGames;
    const finished = await this.#games.countFinished(userId, CASUAL);
    if (finished < required) {
      throw new AppError("FORBIDDEN", `finish ${required - finished} more casual game(s) to play ranked`);
    }
  }

  /**
   * The pairs among these players that played their rated games of the day together (T24), and when each pair may
   * play a ranked game together again. Ranked play between them is refused until then (queue, challenges).
   * @param {readonly string[]} userIds
   * @returns {Promise<readonly Readonly<{ userIds: readonly [string, string], nextAt: number }>[]>}
   */
  async pairsAtLimit(userIds) {
    const limit = this.#settings.fairPlay.maxRatedGamesPerPairPerDay;
    const pairs = await this.#repository.pairsAtLimit(userIds, this.#clock.now() - DAY_MS, limit);
    return Object.freeze(pairs.map((pair) => Object.freeze({ userIds: pair.userIds, nextAt: pair.finishedAt + DAY_MS })));
  }

  /**
   * When two players may play a ranked game together again, or null when they may now.
   * @param {string} userId
   * @param {string} opponentId
   */
  async nextPairGameAt(userId, opponentId) {
    const [pair] = await this.pairsAtLimit([userId, opponentId]);
    return pair?.nextAt ?? null;
  }

  /**
   * Refuses a ranked game between two players who played their rated games of the day together, saying when they may again.
   * @param {string} userId
   * @param {{ userId: string, account: string }} opponent
   */
  async assertPairAllowed(userId, opponent) {
    const nextAt = await this.nextPairGameAt(userId, opponent.userId);
    if (nextAt !== null) {
      throw new AppError("LIMIT_REACHED", `You can play ranked with @${opponent.account} again in ${this.#waitUntil(nextAt)}: ${this.#pairLimitReason()}.`, { opponent: opponent.account, nextAt });
    }
  }

  /**
   * What the queue tells a player it will not pair with `opponent` (who, for how long, why), short enough for the lobby's status.
   * @param {string} opponent the other player's account
   * @param {number} nextAt
   */
  heldApartText(opponent, nextAt) {
    return `You will not be paired with @${opponent} for ${this.#waitUntil(nextAt)}: ${this.#pairLimitReason()}. Looking for someone else…`;
  }

  /** @param {number} at */
  #waitUntil(at) {
    return waitText(at - this.#clock.now());
  }

  #pairLimitReason() {
    const limit = this.#settings.fairPlay.maxRatedGamesPerPairPerDay;
    return `at most ${limit} ranked ${limit === 1 ? "game" : "games"} a day with the same opponent`;
  }

  /**
   * Records a finished game (idempotent). Casual games are ignored.
   * @param {FinishedGame} game
   * @returns {Promise<boolean>} true when this call recorded it
   */
  async record(game) {
    const season = seasonAt(this.#settings, game.finishedAt);
    if (game.mode !== RANKED || season === null || game.players.length !== 2) {
      return false;
    }
    const recorded = await this.#unitOfWork(async () => {
      if (await this.#repository.recorded(game.gameId)) {
        return false;
      }
      // Lock both rows in a fixed order: two games sharing a player never deadlock.
      const ordered = [...game.players].sort((left, right) => (left.userId < right.userId ? -1 : 1));
      const before = new Map();
      for (const player of ordered) {
        before.set(player.userId, await this.#repository.lock({ season: season.id, userId: player.userId, account: player.account, ...DEFAULT_RATING, at: game.finishedAt }));
      }
      const [first, second] = game.players;
      const counted = await this.#repository.countCounted(first.userId, second.userId, game.finishedAt - DAY_MS) < this.#settings.fairPlay.maxRatedGamesPerPairPerDay;
      const firstScore = scoreOf(game.winnerSeat, first.seat);
      const after = rateGame(before.get(first.userId), before.get(second.userId), firstScore);
      for (const [index, player] of [first, second].entries()) {
        const opponent = index === 0 ? second : first;
        const score = index === 0 ? firstScore : /** @type {0 | 0.5 | 1} */ (1 - firstScore);
        await this.#write({ game, season: season.id, player, opponent, score, counted, before: before.get(player.userId), after: after[index] });
      }
      await this.#flag(game, season.id, counted);
      return true;
    });
    if (recorded) {
      this.#logger.info("ranked game recorded", { game: game.gameId, season: season.id });
    }
    return recorded;
  }

  /**
   * @param {{ game: FinishedGame, season: string, player: { userId: string }, opponent: { userId: string }, score: 0 | 0.5 | 1, counted: boolean, before: StoredRating, after: import("../domain/Glicko2.js").Rating }} change
   */
  async #write({ game, season, player, opponent, score, counted, before, after }) {
    const result = counted ? after : before;
    await this.#repository.insertChange({
      gameId: game.gameId,
      userId: player.userId,
      season,
      opponentId: opponent.userId,
      score,
      counted,
      reason: counted ? null : "repeat_pair",
      before,
      after: result,
      endReason: game.endReason,
      endTurn: game.turn,
      finishedAt: game.finishedAt,
    });
    if (counted) {
      await this.#repository.applyResult({ season, userId: player.userId, rating: after.rating, rd: after.rd, volatility: after.volatility, score, at: game.finishedAt });
    }
  }

  /**
   * Fair-play flags for operators.
   * @param {FinishedGame} game
   * @param {string} season
   * @param {boolean} counted
   */
  async #flag(game, season, counted) {
    const [first, second] = game.players;
    const [userA, userB] = [first.userId, second.userId].sort();
    const day = new Date(Math.floor(game.finishedAt / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
    if (!counted) {
      await this.#repository.insertFlag({ season, kind: "repeat_pair", userA, userB, details: { game: game.gameId, day }, fingerprint: `repeat_pair:${season}:${userA}:${userB}:${day}`, at: game.finishedAt });
    }
    const { earlyConcedeTurn, earlyConcedesToFlag, earlyConcedeWindowDays } = this.#settings.fairPlay;
    if (game.endReason !== "concede" || game.turn > earlyConcedeTurn) {
      return;
    }
    const early = await this.#repository.countEarlyConcedes({ userId: first.userId, opponentId: second.userId, since: game.finishedAt - earlyConcedeWindowDays * DAY_MS, turn: earlyConcedeTurn });
    if (early >= earlyConcedesToFlag) {
      await this.#repository.insertFlag({ season, kind: "early_concedes", userA, userB, details: { games: early, lastGame: game.gameId }, fingerprint: `early_concedes:${season}:${userA}:${userB}:${day}`, at: game.finishedAt });
    }
  }

  /** Records ranked games of the last two days that were missed. */
  async catchUp() {
    let recorded = 0;
    for (const game of await this.#games.finishedGames({ mode: RANKED, since: this.#clock.now() - CATCH_UP_WINDOW_MS })) {
      recorded += (await this.record(game)) ? 1 : 0;
    }
    return recorded;
  }

  /**
   * The season's players: settled ratings ranked first, then provisional ones (listed, but with no rank yet).
   * @param {string | null} [seasonId] default: the current season
   */
  async leaderboard(seasonId = null) {
    const season = seasonId === null ? this.currentSeason() : this.#settings.seasons.find((candidate) => candidate.id === seasonId) ?? null;
    if (season === null) {
      return Object.freeze({ season: null, entries: Object.freeze([]) });
    }
    const rows = await this.#repository.leaderboard({ season: season.id, minGames: SETTLED_GAMES, limit: LEADERBOARD_SIZE });
    return Object.freeze({
      season: Object.freeze({ id: season.id, name: season.name }),
      entries: Object.freeze(
        rows.map((row, index) => {
          const provisional = row.games < SETTLED_GAMES;
          return Object.freeze({ rank: provisional ? null : index + 1, provisional, account: row.account, rating: Math.round(row.rating), games: row.games, wins: row.wins, losses: row.losses, draws: row.draws });
        }),
      ),
    });
  }

  /**
   * A player's standing: rating, record, rank (null while provisional), and whether they may play ranked.
   * @param {string} userId
   */
  async standing(userId) {
    const rating = await this.ratingOf(userId);
    const provisional = rating.games < SETTLED_GAMES;
    const rank = provisional || rating.season === null ? null : (await this.#repository.countAbove({ season: rating.season, minGames: SETTLED_GAMES, rating: rating.rating })) + 1;
    const casualGames = await this.#games.countFinished(userId, CASUAL);
    const season = this.currentSeason();
    return Object.freeze({
      season: season === null ? null : Object.freeze({ id: season.id, name: season.name }),
      rating: Math.round(rating.rating),
      deviation: Math.round(rating.rd),
      provisional,
      rank,
      games: rating.games,
      wins: rating.wins,
      losses: rating.losses,
      draws: rating.draws,
      eligible: season !== null && casualGames >= this.#settings.eligibility.minFinishedCasualGames,
      casualGamesNeeded: Math.max(0, this.#settings.eligibility.minFinishedCasualGames - casualGames),
    });
  }

  /**
   * The season's first `places` settled ratings, best first (provisional ones win nothing).
   * @param {string} seasonId
   * @param {number} places
   * @returns {Promise<readonly Readonly<{ rank: number, userId: string, account: string, rating: number }>[]>}
   */
  async podium(seasonId, places) {
    const rows = await this.#repository.leaderboard({ season: seasonId, minGames: SETTLED_GAMES, limit: places });
    return Object.freeze(rows.filter((row) => row.games >= SETTLED_GAMES).map((row, index) => Object.freeze({ rank: index + 1, userId: row.userId, account: row.account, rating: Math.round(row.rating) })));
  }

  /** @param {number} [limit] */
  flags(limit = 100) {
    return this.#repository.openFlags(limit);
  }
}
