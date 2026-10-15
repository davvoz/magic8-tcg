/**
 * Tries the search AI's moves on a rebuilt game (PerspectiveWorld): plays a
 * command on a fork of the game, then lets the opponent answer for as long
 * as the turn is the AI's and the opponent has to act (blocks), until the
 * AI decides again, the turn passes or the game ends.
 *
 * It also keeps the decision within budget: every command it executes,
 * the opponent's included, counts against a fixed number of simulations.
 * The budget counts moves, not time, so the AI decides the same way on any
 * machine (and the domain has no clock).
 */

/** @typedef {import("../../game/GameEngine.js").GameEngine} GameEngine */

/** Opponent answers in a row before the simulator gives up on a line: real turns need one (blocks). */
const MAX_REPLIES = 4;
/** Moves in the opponent's turn the simulator plays out before it stops looking: a turn of attacks needs a handful. */
const MAX_TURN_MOVES = 24;

export class Simulator {
  #playerId;
  #opponentId;
  #opponent;
  #remaining;

  /**
   * @param {{ playerId: string, opponentId: string, opponent: import("./OpponentModel.js").OpponentModel, simulations: number }} options
   *   `playerId`: the AI's seat; `simulations`: the budget
   */
  constructor({ playerId, opponentId, opponent, simulations }) {
    this.#playerId = playerId;
    this.#opponentId = opponentId;
    this.#opponent = opponent;
    this.#remaining = simulations;
  }

  /**
   * Plays the opponent's whole turn as the opponent model expects it (it
   * cannot play the cards it holds: they are unknown; it attacks with what
   * it has), the AI blocking as the model would in its place, up to the
   * AI's next decision.
   * @param {GameEngine} engine at the start of the opponent's turn; left untouched
   * @returns {GameEngine}
   */
  playOpponentTurn(engine) {
    const next = engine.fork();
    for (let moves = 0; moves < MAX_TURN_MOVES && !next.isOver && next.activePlayerId === this.#opponentId; moves += 1) {
      const actor = next.awaitingPlayerId;
      const move = actor === null ? null : this.#opponent.answer(next, actor);
      if (move === null || !this.#execute(next, move)) {
        break;
      }
    }
    return next;
  }

  get playerId() {
    return this.#playerId;
  }

  /** The budget is spent: callers stop opening new lines (closing open ones may still run). */
  get exhausted() {
    return this.#remaining <= 0;
  }

  /**
   * @param {GameEngine} engine left untouched
   * @param {Readonly<Record<string, unknown>>} command the AI's move
   * @returns {GameEngine | null} the game after the move and any answers; null when the move is not legal there
   */
  play(engine, command) {
    const next = engine.fork();
    if (!this.#execute(next, command)) {
      return null;
    }
    let replies = 0;
    while (this.#opponentMustAnswer(next)) {
      const answer = replies < MAX_REPLIES ? this.#opponent.answer(next, this.#opponentId) : null;
      if (answer === null || !this.#execute(next, answer)) {
        return null;
      }
      replies += 1;
    }
    return next;
  }

  /**
   * The AI's own turn is over (or the whole game): nothing more to decide in this line.
   * @param {GameEngine} engine
   */
  isTurnOver(engine) {
    return engine.isOver || engine.activePlayerId !== this.#playerId;
  }

  /** @param {GameEngine} engine */
  #opponentMustAnswer(engine) {
    return !engine.isOver && engine.activePlayerId === this.#playerId && engine.awaitingPlayerId === this.#opponentId;
  }

  /**
   * @param {GameEngine} engine
   * @param {Readonly<Record<string, unknown>>} command
   */
  #execute(engine, command) {
    this.#remaining -= 1;
    return engine.execute(command).ok;
  }
}
