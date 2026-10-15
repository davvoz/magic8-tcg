/**
 * Plays a bot's seat in an online game: whenever the server's latest view
 * says it is our move, think a moment (a person needs a second or two, and
 * the opponent's table needs to show what happened), then send what the
 * engine's AI (`BasicAi`, the same rules as practice and auto games) would
 * do, through the session like a click would.
 *
 * The AI only ever sees our own snapshot, as the server sends it. A move the
 * server refuses because the game moved on (STALE_VERSION) is decided again
 * on the next view, and one that arrives after the game ended (the opponent
 * conceded meanwhile: GAME_NOT_ACTIVE) is simply dropped; any other refusal
 * falls back once to the smallest move (no attack, no block, end the phase or
 * turn), and a move that could not
 * be sent at all (connection lost) is tried again a little later. The
 * server's turn clock remains the last word: a seat that does not act is
 * moved for.
 */
import { AiStyle, BasicAi } from "@magic8/engine/domain/ai/BasicAi.js";
import { declareAttackers, declareBlockers, endPhase, endTurn } from "@magic8/engine/domain/commands/commandFactories.js";
import { GamePhase } from "@magic8/engine/domain/game/GamePhase.js";

/** A move that could not be sent is tried again after this long, a few times. */
const RETRY_MS = 2000;
const MAX_ATTEMPTS = 3;

/**
 * @typedef {import("@magic8/client/src/application/online/RemoteMatchSession.js").RemoteMatchSession} RemoteMatchSession
 */

export class BotPlayer {
  #ai;
  #think;
  #delay;
  #logger;
  /** @type {RemoteMatchSession | null} */
  #session = null;
  /** @type {(() => void) | null} */
  #unsubscribe = null;
  /** The view a move is being decided for ("game:version"), so one view gets one move. @type {string | null} */
  #planned = null;
  /** Moves that could not be sent, for the view they were decided on. */
  #unsent = { view: "", count: 0 };
  /** Games in which we have moved already (the first move waits for the opening coin toss). @type {Set<string>} */
  #moved = new Set();

  /**
   * @param {{
   *   style?: string,
   *   think: (opening: boolean) => number,
   *   delay: (ms: number) => Promise<void>,
   *   logger: import("@magic8/client/src/application/ports/Logger.contract.js").Logger,
   * }} deps `think`: how long to wait before a move, in ms (`opening`: our first move of the game)
   */
  constructor({ style = AiStyle.BALANCED, think, delay, logger }) {
    this.#ai = new BasicAi(style);
    this.#think = think;
    this.#delay = delay;
    this.#logger = logger;
  }

  /**
   * Plays this session from now on (and stops following any other).
   * @param {RemoteMatchSession | null} session
   */
  follow(session) {
    if (session === this.#session) {
      return;
    }
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#session = session;
    this.#planned = null;
    if (session !== null) {
      this.#unsubscribe = session.subscribe(() => void this.#consider());
      void this.#consider();
    }
  }

  stop() {
    this.follow(null);
  }

  /** Our move, if the latest view asks for one and none is on its way. */
  async #consider() {
    const session = this.#session;
    const snapshot = session === null || session.isStopped || session.seat === null ? null : session.snapshotFor(session.seat);
    if (session === null || !isOurs(snapshot, session.seat)) {
      return;
    }
    const planned = `${session.gameId}:${session.version}`;
    if (this.#planned === planned) {
      return;
    }
    this.#planned = planned;
    const opening = !this.#moved.has(session.gameId);
    await this.#delay(this.#think(opening));
    if (this.#session !== session || `${session.gameId}:${session.version}` !== planned || session.isStopped) {
      return;
    }
    await this.#move(session, session.snapshotFor(session.seat), planned);
  }

  /**
   * @param {RemoteMatchSession} session
   * @param {any} snapshot
   * @param {string} planned
   */
  async #move(session, snapshot, planned) {
    const seat = /** @type {string} */ (session.seat);
    const decided = this.#decide(snapshot);
    let result = await session.submit(decided);
    if (!result.ok && !movedOn(result.error.code) && !unsent(result.error.code)) {
      this.#logger.warn("the server refused the AI's move; making the smallest one", { gameId: session.gameId, code: result.error.code, message: result.error.message, command: decided.type });
      result = await session.submit(smallestMove(seat, snapshot));
    }
    if (result.ok) {
      this.#moved.add(session.gameId);
      return;
    }
    if (!unsent(result.error.code) || this.#planned !== planned) {
      return;
    }
    this.#unsent = { view: planned, count: this.#unsent.view === planned ? this.#unsent.count + 1 : 1 };
    if (this.#unsent.count < MAX_ATTEMPTS) {
      // Not sent (connection lost meanwhile): the same view gets another go a little later.
      this.#planned = null;
      await this.#delay(RETRY_MS);
      void this.#consider();
    }
  }

  /** @param {any} snapshot */
  #decide(snapshot) {
    try {
      return this.#ai.decide(snapshot) ?? smallestMove(snapshot.perspectivePlayerId, snapshot);
    } catch (error) {
      this.#logger.error("the AI could not decide; making the smallest move", { error: error instanceof Error ? error.message : String(error) });
      return smallestMove(snapshot.perspectivePlayerId, snapshot);
    }
  }
}

/**
 * Whether the view is waiting for a move of ours.
 * @param {any} snapshot
 * @param {string | null} seat
 */
function isOurs(snapshot, seat) {
  return snapshot !== null && snapshot !== undefined && seat !== null && snapshot.isOver !== true && snapshot.awaitingPlayerId === seat && snapshot.legalMoves !== null && snapshot.legalMoves !== undefined;
}

/**
 * Refusals because the game went on without us (a newer view, or the game ended): nothing to correct.
 * @param {string} code
 */
function movedOn(code) {
  return code === "STALE_VERSION" || code === "GAME_NOT_ACTIVE";
}

/**
 * Failures where the move never reached the server.
 * @param {string} code
 */
function unsent(code) {
  return code === "NOT_CONNECTED" || code === "TIMEOUT" || code === "SESSION_REQUIRED";
}

/**
 * The smallest move: no attack, no block, otherwise end the turn, or at least the phase (as the server's forced move).
 * @param {string} seat
 * @param {any} snapshot
 */
export function smallestMove(seat, snapshot) {
  if (snapshot.phase === GamePhase.COMBAT_BLOCKERS) {
    return declareBlockers(seat, []);
  }
  if (snapshot.phase === GamePhase.COMBAT_ATTACKERS) {
    return declareAttackers(seat, []);
  }
  return snapshot.legalMoves?.canEndTurn === true ? endTurn(seat) : endPhase(seat);
}
