/**
 * Replays a played auto game on the board (docs/tcg/23-automatica.md).
 *
 * The server publishes the game's events: the entropy each player gave,
 * who plays first, every move, and at the end the secret and both decks.
 * That is all the engine needs to deal the same hands and play the same
 * game. The replay is a local MatchSession whose two seats are controllers
 * that make the recorded moves in turn, so the board shows it the way it
 * shows any match — the coin toss, the cards, the sounds. Both seats are
 * the AI's, but a player watching their own game sees it from their seat,
 * as they see a game they play: their hand, their side of the table, the
 * help if they turn it on. Anyone else watches it as a spectator.
 *
 * The player picks how fast it plays (ReplayPace): Normal and Fast wait
 * for the board to show each move whole, Very fast does not. The next
 * replay starts at the speed picked last.
 *
 * Before anything is shown, the whole game is played through once, off
 * screen: a game this browser's cards cannot play to the recorded end (it
 * was played with other cards) is refused rather than shown wrong.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ChaChaRandom } from "@magic8/engine/domain/random/ChaChaRandom.js";
import { CoinToss } from "../match/CoinToss.js";
import { ReplayPace, ReplaySpeed } from "./ReplayPace.js";
import { MatchSession } from "../match/MatchSession.js";
import { ControllerKind } from "../match/PlayerController.contract.js";
import { textSeed } from "../match/textSeed.js";

export const ReplayError = Object.freeze({
  /** The game's events are not a whole auto game. */
  MALFORMED: "MALFORMED",
  /** This browser's cards do not play the game to its recorded end. */
  UNREPLAYABLE: "UNREPLAYABLE",
});

const SEATS = Object.freeze(["s0", "s1"]);

/**
 * A seat that makes, in turn, the moves recorded for it.
 */
class RecordedMoves {
  kind = ControllerKind.AI;
  #moves;
  #next = 0;

  /**
   * @param {string} seat
   * @param {readonly Readonly<Record<string, unknown>>[]} moves the seat's commands, in order
   */
  constructor(seat, moves) {
    this.#moves = moves.map((move) => Object.freeze({ ...move, playerId: seat }));
  }

  decide() {
    const move = this.#moves[this.#next] ?? null;
    this.#next += 1;
    return move;
  }
}

export class AutoReplayService {
  #api;
  #content;
  #effects;
  #buildEngine;
  #scheduler;
  #logger;
  /** The speed picked last: the next replay starts at it. @type {string} */
  #speed = ReplaySpeed.NORMAL;

  /**
   * @param {{
   *   api: import("../ports/AutoApi.contract.js").AutoApi,
   *   content: import("../content/ContentService.js").GameContent,
   *   effects: import("@magic8/engine/domain/effects/EffectRegistry.js").EffectRegistry,
   *   buildEngine: import("../ports/RecordedGameEngine.contract.js").BuildRecordedGameEngine,
   *   scheduler: import("../ports/Scheduler.contract.js").Scheduler,
   *   logger: import("../ports/Logger.contract.js").Logger,
   * }} deps
   */
  constructor({ api, content, effects, buildEngine, scheduler, logger }) {
    this.#api = api;
    this.#content = content;
    this.#effects = effects;
    this.#buildEngine = buildEngine;
    this.#scheduler = scheduler;
    this.#logger = logger;
  }

  /**
   * Reads a played auto game and makes the session that replays it.
   * @param {string} gameId
   * @param {{ viewer?: string | null }} [options] `viewer`: the signed-in account, which sees the game from its seat if it played it
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<{ session: MatchSession, replay: import("../ports/AutoApi.contract.js").AutoGameReplay }> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async open(gameId, { viewer = null } = {}) {
    const read = await this.#api.replay(gameId);
    if (!read.ok) {
      return read;
    }
    const pace = new ReplayPace({ scheduler: this.#scheduler, speed: this.#speed, onSpeed: (speed) => (this.#speed = speed) });
    const session = replaySession({ replay: read.value, content: this.#content, effects: this.#effects, buildEngine: this.#buildEngine, scheduler: this.#scheduler, logger: this.#logger, pace, viewer });
    if (!session.ok) {
      this.#logger.warn("an auto game could not be replayed", { game: gameId, error: session.error });
      return session;
    }
    return ok(Object.freeze({ session: session.value, replay: read.value }));
  }
}

/**
 * The session that replays an auto game, once it is known to play to its recorded end.
 * @param {{
 *   replay: import("../ports/AutoApi.contract.js").AutoGameReplay,
 *   content: import("../content/ContentService.js").GameContent,
 *   effects: import("@magic8/engine/domain/effects/EffectRegistry.js").EffectRegistry,
 *   buildEngine: import("../ports/RecordedGameEngine.contract.js").BuildRecordedGameEngine,
 *   scheduler: import("../ports/Scheduler.contract.js").Scheduler,
 *   logger: import("../ports/Logger.contract.js").Logger,
 *   pace?: ReplayPace | null,
 *   viewer?: string | null,
 * }} input `pace`: how fast it plays (none: as fast as the scheduler lets it); `viewer`: the account looking, seated if it played
 * @returns {import("@magic8/engine/shared/Result.js").Ok<MatchSession> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function replaySession({ replay, content, effects, buildEngine, scheduler, logger, pace = null, viewer = null }) {
  const game = gameOf(replay);
  if (game === null) {
    return fail(ReplayError.MALFORMED, "this game's record is incomplete");
  }
  const build = () => buildEngine({ content, effects, gameId: replay.gameId, accounts: game.accounts, decks: game.decks, firstSeat: game.first, secret: game.secret, entropies: game.entropies });
  const trial = build();
  if (!trial.ok) {
    return fail(ReplayError.UNREPLAYABLE, "this game was played with other cards than the ones this game knows: it cannot be replayed");
  }
  if (!playsToItsEnd(trial.value, game)) {
    return fail(ReplayError.UNREPLAYABLE, "this game was played with other cards than the ones this game knows: it cannot be replayed");
  }
  const engine = /** @type {import("@magic8/engine/shared/Result.js").Ok<any>} */ (build()).value;
  const controllers = new Map(SEATS.map((seat) => [seat, new RecordedMoves(seat, game.moves.filter((move) => move.seat === seat).map((move) => move.command))]));
  const openingToss = CoinToss.decided({ playerIds: SEATS, firstPlayerId: game.first, random: ChaChaRandom.fromSeed(textSeed(replay.gameId)) });
  const accounts = new Map(SEATS.map((seat, index) => [seat, game.accounts[index]]));
  const viewerId = SEATS.find((seat) => viewer !== null && accounts.get(seat) === viewer) ?? null;
  return ok(new MatchSession({ engine, controllers, scheduler, logger, pace, viewerId, openingToss, accounts }));
}

/**
 * What the replay needs from the game's events, or null when they are not a whole game.
 * @param {import("../ports/AutoApi.contract.js").AutoGameReplay} replay
 */
function gameOf(replay) {
  const { events } = replay;
  const started = events.find((event) => event.k === "GAME_STARTED");
  const finished = events.find((event) => event.k === "GAME_FINISHED");
  const entropies = SEATS.map((seat) => events.find((event) => event.k === "PLAYER_JOINED" && event.a === seat)?.d?.ent);
  const accounts = SEATS.map((seat) => replay.players.find((player) => player.seat === seat)?.account);
  if (started === undefined || finished === undefined || !SEATS.includes(started.d.first) || typeof finished.d.secret !== "string" || !Array.isArray(finished.d.decks)) {
    return null;
  }
  if (entropies.some((entropy) => typeof entropy !== "string") || accounts.some((account) => account === undefined)) {
    return null;
  }
  const moves = events.filter((event) => event.k === "MOVE" && SEATS.includes(/** @type {string} */ (event.a))).map((event) => Object.freeze({ seat: /** @type {string} */ (event.a), command: event.d }));
  return Object.freeze({
    first: /** @type {string} */ (started.d.first),
    secret: /** @type {string} */ (finished.d.secret),
    decks: finished.d.decks,
    winner: finished.d.win ?? null,
    entropies: /** @type {string[]} */ (entropies),
    accounts: /** @type {string[]} */ (accounts),
    moves,
  });
}

/**
 * Whether the engine plays every recorded move, and ends where the record says.
 * @param {import("@magic8/engine/domain/game/GameEngine.js").GameEngine} engine
 * @param {NonNullable<ReturnType<typeof gameOf>>} game
 */
function playsToItsEnd(engine, game) {
  if (!engine.start().ok) {
    return false;
  }
  for (const move of game.moves) {
    if (!engine.execute({ ...move.command, playerId: move.seat }).ok) {
      return false;
    }
  }
  const end = engine.getSnapshot(null);
  return end.isOver && end.winnerId === game.winner;
}
