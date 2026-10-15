/**
 * DailyChallengeService: the daily challenges (docs/tcg/24-sfide.md).
 *
 * Every day (UTC) brings the same three opponents to every player
 * (DailySchedule): two characters, then a boss. A player picks the day's
 * track (Normal for a Core Mini Booster, Hard for a Core Booster against
 * stronger AIs) and plays the challenges in order, whenever they like that
 * day, as often as they need: a lost challenge is played again. Winning the
 * third wins the pack (DailyRewarder), once a day.
 *
 * A challenge is a game like any other (gameplay module), the player's deck
 * against the character's, the server's AI playing the character's seat at
 * the track's level. This service only creates those games and, when one
 * ends (onGameFinished, onGameAborted), settles it: once, in one unit of
 * work with the run's progress and, after the third win, the reward.
 */
import { GameMode } from "@magic8/protocol";
import { AppError } from "../../../kernel/AppError.js";
import { assertImplements } from "../../../kernel/contracts.js";
import { conditionsAt } from "../domain/DailyRoster.js";
import { CHALLENGES_PER_DAY, TRACK_IDS } from "../domain/DailyTracks.js";
import { dayOf, endOf } from "../domain/dailyDay.js";
import { DAILY_REPOSITORY_METHODS } from "./ports.js";

/** The seat the player takes; the AI takes the other. */
const PLAYER_SEAT = "s0";
const AI_SEAT = "s1";
/** A character sits at the table as this account: never a STEEM account, which cannot hold "_". */
export const aiAccountOf = (opponentId) => `ai_${opponentId}`;

/**
 * @typedef {import("./ports.js").DailyRun} DailyRun
 * @typedef {import("../domain/DailyRoster.js").Opponent} Opponent
 */

export class DailyChallengeService {
  #repository;
  #schedule;
  #tracks;
  #games;
  #decks;
  #rewarder;
  #audit;
  #clock;
  #unitOfWork;
  #logger;
  #gate;

  /**
   * @param {{
   *   repository: import("./ports.js").DailyRepository,
   *   schedule: import("../domain/DailySchedule.js").DailySchedule,
   *   tracks: import("../domain/DailyTracks.js").DailyTracks,
   *   games: import("../../gameplay/index.js").GameService,
   *   decks: { playableDeckList: (userId: string, deckId: unknown) => Promise<import("@magic8/engine/domain/decks/DeckList.js").DeckList> },
   *   rewarder: import("./DailyRewarder.js").DailyRewarder,
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   clock: import("../../../kernel/time.js").Clock,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   logger: import("../../../kernel/logger.js").Logger,
   *   gate?: { assertOpen: (what: string) => void },
   * }} deps `gate`: closes new games during an announced maintenance
   */
  constructor({ repository, schedule, tracks, games, decks, rewarder, audit, clock, unitOfWork, logger, gate = { assertOpen: () => undefined } }) {
    assertImplements(repository, DAILY_REPOSITORY_METHODS, "DailyRepository");
    this.#repository = repository;
    this.#schedule = schedule;
    this.#tracks = tracks;
    this.#games = games;
    this.#decks = decks;
    this.#rewarder = rewarder;
    this.#audit = audit;
    this.#clock = clock;
    this.#unitOfWork = unitOfWork;
    this.#logger = logger;
    this.#gate = gate;
  }

  /**
   * Today as a player sees it: the opponents, the tracks, and their own progress.
   * @param {string} userId
   */
  async today(userId) {
    const day = dayOf(this.#clock.now());
    const run = await this.#repository.findRun(userId, day);
    const games = run === null ? [] : await this.#repository.listGames(userId, day);
    // The game settled last (the furthest one, should two end at the same moment).
    const settled = games.filter((game) => game.settledAt !== null).sort((one, other) => /** @type {number} */ (one.settledAt) - /** @type {number} */ (other.settledAt) || one.stage - other.stage);
    return this.#view(day, run, settled.at(-1) ?? null);
  }

  /**
   * Picks the day's track; it cannot change afterwards. Picking the same track again is harmless.
   * @param {string} userId
   * @param {unknown} trackId
   */
  async chooseTrack(userId, trackId) {
    const track = typeof trackId === "string" ? this.#tracks.get(trackId) : undefined;
    if (track === undefined) {
      throw new AppError("VALIDATION", `the track must be one of ${TRACK_IDS.join(", ")}`);
    }
    const day = dayOf(this.#clock.now());
    const run = await this.#unitOfWork(async () => {
      const existing = await this.#repository.lockRun(userId, day);
      if (existing !== null) {
        if (existing.track !== track.id) {
          throw new AppError("CONFLICT", `today's track is ${existing.track}; it changes tomorrow`);
        }
        return existing;
      }
      /** @type {DailyRun} */
      const created = Object.freeze({ userId, day, track: track.id, stage: 0, gameId: null, attempts: 0, rewardSeed: null, rewardCards: null, rewardedAt: null, createdAt: this.#clock.now() });
      await this.#repository.insertRun(created);
      return created;
    });
    return this.#view(day, run);
  }

  /**
   * Starts the next challenge with one of the player's decks, or gives back the one already in play.
   * @param {{ user: { id: string, account: string }, deckId: unknown }} request
   * @returns {Promise<Readonly<{ gameId: string }>>}
   */
  async play({ user, deckId }) {
    const day = dayOf(this.#clock.now());
    const run = await this.#repository.findRun(user.id, day);
    if (run === null) {
      throw new AppError("PRECONDITION_REQUIRED", "choose today's track first");
    }
    if (run.stage >= CHALLENGES_PER_DAY) {
      throw new AppError("CONFLICT", "you have won today's challenges; new ones start tomorrow");
    }
    const active = await this.#games.activeGameOf(user.id);
    if (active !== null) {
      if (active === run.gameId) {
        return Object.freeze({ gameId: active });
      }
      throw new AppError("CONFLICT", "you are already in a game");
    }
    this.#gate.assertOpen("Daily challenges");
    const deck = await this.#decks.playableDeckList(user.id, deckId);
    const staged = await this.#unitOfWork(() => this.#stage({ user, deckId: /** @type {string} */ (deckId), deck, day }));
    this.#games.launchGame(staged);
    return Object.freeze({ gameId: staged.game.id });
  }

  /**
   * Settles a finished challenge game (a finished-game listener of the gameplay module).
   * @param {import("../../gameplay/application/ports.js").FinishedGame} summary
   */
  async onGameFinished(summary) {
    if (summary.mode !== GameMode.DAILY) {
      return;
    }
    const result = resultFor(summary.winnerSeat);
    await this.#unitOfWork(() => this.#settle(summary.gameId, result));
  }

  /**
   * Settles a challenge game called off before it started (an aborted-game listener): it does not count.
   * @param {import("../../gameplay/application/ports.js").AbortedGame} summary
   */
  async onGameAborted(summary) {
    if (summary.mode === GameMode.DAILY) {
      await this.#settle(summary.gameId, "aborted");
    }
  }

  /**
   * Writes the next challenge's game for the player (inside the caller's unit of work).
   * @param {{ user: { id: string, account: string }, deckId: string, deck: import("@magic8/engine/domain/decks/DeckList.js").DeckList, day: string }} request
   */
  async #stage({ user, deckId, deck, day }) {
    const run = await this.#repository.lockRun(user.id, day);
    if (run === null || run.stage >= CHALLENGES_PER_DAY || run.gameId !== null) {
      throw new AppError("CONFLICT", "today's challenges changed meanwhile; reload them");
    }
    const opponent = this.#schedule.forDay(day)[run.stage];
    const track = /** @type {import("../domain/DailyTracks.js").Track} */ (this.#tracks.get(run.track));
    const attempt = run.attempts + 1;
    const staged = await this.#games.stageGame({
      mode: GameMode.DAILY,
      conditions: conditionsAt(opponent, { challenger: PLAYER_SEAT, opponent: AI_SEAT }),
      entrants: [
        { userId: user.id, account: user.account, deckId, deck: deck.entries },
        {
          userId: null,
          account: aiAccountOf(opponent.id),
          deckId: null,
          deck: opponent.deck.entries,
          ai: Object.freeze({ id: opponent.id, level: track.levels[run.stage], style: opponent.style, salt: `${day}|${user.id}|${attempt}` }),
        },
      ],
    });
    const gameId = staged.game.id;
    await this.#repository.insertGame({ gameId, userId: user.id, day, stage: run.stage, opponent: opponent.id, result: null, createdAt: this.#clock.now(), settledAt: null });
    await this.#repository.updateRun(user.id, day, { gameId, attempts: attempt });
    await this.#audit.record({ actorKind: "user", actorUserId: user.id, action: "daily.challenge_started", targetKind: "game", targetId: gameId, details: { day, track: track.id, stage: run.stage, opponent: opponent.id, level: track.levels[run.stage], attempt } });
    return staged;
  }

  /**
   * Records how a challenge game went, once, and moves the player's day on (inside a unit of work).
   * @param {string} gameId
   * @param {string} result the player's: win | loss | draw | aborted
   */
  async #settle(gameId, result) {
    const game = await this.#repository.settleGame(gameId, result, this.#clock.now());
    if (game === null) {
      return;
    }
    const run = await this.#repository.lockRun(game.userId, game.day);
    if (run === null) {
      throw new Error(`daily game ${gameId} has no run`);
    }
    const won = result === "win" && run.stage === game.stage;
    const stage = won ? run.stage + 1 : run.stage;
    await this.#repository.updateRun(game.userId, game.day, { ...(run.gameId === gameId ? { gameId: null } : {}), stage });
    if (won && stage === CHALLENGES_PER_DAY) {
      await this.#reward({ ...run, stage });
    }
    this.#logger.info("daily challenge settled", { game: gameId, user: game.userId, day: game.day, stage: game.stage, result });
  }

  /** @param {DailyRun} run with all three challenges won */
  async #reward(run) {
    if (run.rewardedAt !== null) {
      return;
    }
    const track = /** @type {import("../domain/DailyTracks.js").Track} */ (this.#tracks.get(run.track));
    const { seed, cards } = await this.#rewarder.reward({ userId: run.userId, day: run.day, track });
    const rewardCards = cards.map((copy) => Object.freeze({ id: copy.id, definitionId: copy.definitionId, serial: copy.serial }));
    await this.#repository.updateRun(run.userId, run.day, { rewardSeed: seed, rewardCards, rewardedAt: this.#clock.now() });
    await this.#audit.record({ actorKind: "system", action: "daily.rewarded", targetKind: "user", targetId: run.userId, details: { day: run.day, track: track.id, pack: track.reward, seed, cards: cards.length } });
  }

  /**
   * @param {string} day
   * @param {DailyRun | null} run
   * @param {import("./ports.js").DailyGame | null} [last] the player's last challenge of the day that is over
   */
  #view(day, run, last = null) {
    const opponents = this.#schedule.forDay(day);
    return Object.freeze({
      day,
      endsAt: endOf(day),
      tracks: Object.freeze(this.#tracks.all().map((track) => Object.freeze({ id: track.id, name: track.name, reward: track.reward }))),
      opponents: Object.freeze(opponents.map((opponent, stage) => opponentView(opponent, { stage, run }))),
      run: run === null ? null : runView(run, last, this.#tracks),
    });
  }
}

/**
 * The player's day as the client shows it: the track, the challenges won, the game in play, how the last one went, and
 * the pack once won.
 * @param {DailyRun} run
 * @param {import("./ports.js").DailyGame | null} last
 * @param {import("../domain/DailyTracks.js").DailyTracks} tracks
 */
function runView(run, last, tracks) {
  return Object.freeze({
    track: run.track,
    stage: run.stage,
    gameId: run.gameId,
    attempts: run.attempts,
    rewarded: run.rewardedAt !== null,
    last: last === null ? null : Object.freeze({ gameId: last.gameId, stage: last.stage, opponent: last.opponent, result: last.result }),
    reward: run.rewardCards === null ? null : Object.freeze({ pack: tracks.get(run.track)?.reward ?? null, cards: run.rewardCards }),
  });
}

/**
 * An opponent as the client shows it: who, with what, and how far the player got against it.
 * @param {Opponent} opponent
 * @param {{ stage: number, run: DailyRun | null }} context
 */
function opponentView(opponent, { stage, run }) {
  const state = stateOf(stage, run?.stage ?? 0);
  return Object.freeze({
    id: opponent.id,
    account: aiAccountOf(opponent.id),
    name: opponent.name,
    title: opponent.title,
    faction: opponent.faction,
    style: opponent.style,
    boss: opponent.boss,
    deck: Object.freeze({ name: opponent.deck.name, size: opponent.deck.totalCards }),
    lines: opponent.lines,
    conditions: Object.freeze(opponent.conditions.map(({ name, text, scope }) => Object.freeze({ name, text, scope }))),
    state,
  });
}

/**
 * @param {number} stage the challenge's place in the day
 * @param {number} progress challenges the player has won
 * @returns {"beaten" | "next" | "locked"}
 */
function stateOf(stage, progress) {
  if (stage < progress) {
    return "beaten";
  }
  return stage === progress ? "next" : "locked";
}

/** @param {string | null} winnerSeat */
function resultFor(winnerSeat) {
  if (winnerSeat === null) {
    return "draw";
  }
  return winnerSeat === PLAYER_SEAT ? "win" : "loss";
}
