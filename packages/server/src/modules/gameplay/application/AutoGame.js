/**
 * An auto game played to its end (docs/tcg/23-automatica.md): the engine's
 * AI decides for both seats, each with its player's style, and every move is
 * recorded as the protocol records any move (game protocol v1: moves as the
 * server recorded them, a state checkpoint at each turn, the secret revealed
 * at the end). Nothing waits on anyone, so a whole game is a loop over the
 * engine that takes milliseconds.
 *
 * The AI only ever answers from its own seat's snapshot. Should it have
 * nothing to submit, or submit something the engine refuses (a bug), the
 * seat makes the smallest move a forced move would (no attack, no block, end
 * the phase or the turn), so a game always ends.
 */
import { BasicAi } from "@magic8/engine/domain/ai/BasicAi.js";
import { SEATS } from "@magic8/protocol";
import { forcedCommandFor } from "../domain/forcedCommand.js";

/** Moves an auto game may take before it is given up as a bug (real games take a few hundred). */
export const MAX_AUTO_MOVES = 20_000;

/**
 * @typedef {import("@magic8/protocol").ChainedEvent} ChainedEvent
 * @typedef {Readonly<{ chained: readonly ChainedEvent[], winner: string | null, reason: string, turn: number, version: number, fallbacks: number }>} PlayedGame
 *   `fallbacks`: moves the AI could not make, replaced by the smallest move
 */

/**
 * Plays a started engine to the end, recording each move.
 * @param {{
 *   engine: import("@magic8/engine/domain/game/GameEngine.js").GameEngine,
 *   recorder: import("@magic8/protocol").GameRecorder,
 *   styles: readonly string[],
 *   maxMoves?: number,
 * }} game `styles` in seat order
 * @returns {PlayedGame}
 */
export function playAutoGame({ engine, recorder, styles, maxMoves = MAX_AUTO_MOVES }) {
  /** @type {Map<string, BasicAi>} */
  const players = new Map(SEATS.map((seat, index) => [seat, new BasicAi(styles[index])]));
  /** @type {ChainedEvent[]} */
  const chained = [];
  let fallbacks = 0;
  for (let moves = 0; moves < maxMoves; moves += 1) {
    const before = engine.getSnapshot(null);
    const seat = before.awaitingPlayerId;
    if (seat === null) {
      throw new Error("auto game: the engine waits on nobody but the game is not over");
    }
    const { command, fallback } = decide(engine, /** @type {BasicAi} */ (players.get(seat)), seat);
    fallbacks += fallback ? 1 : 0;
    const after = engine.getSnapshot(null);
    const clock = { turn: after.turnNumber, ms: 0 };
    chained.push(recorder.move({ seat, command, clock }));
    if (after.isOver) {
      const reason = /** @type {string} a finished game has a reason */ (after.endReason);
      chained.push(recorder.finished({ winner: after.winnerId, reason, engineVersion: engine.version, digest: engine.getStateDigest(), clock }));
      return Object.freeze({ chained: Object.freeze(chained), winner: after.winnerId, reason, turn: after.turnNumber, version: engine.version, fallbacks });
    }
    if (after.turnNumber !== before.turnNumber) {
      chained.push(recorder.checkpoint({ engineVersion: engine.version, digest: engine.getStateDigest(), clock }));
    }
  }
  throw new Error(`auto game: no end after ${maxMoves} moves`);
}

/**
 * Runs the AI's move for a seat, or the smallest move when the AI has none the engine accepts.
 * @param {import("@magic8/engine/domain/game/GameEngine.js").GameEngine} engine
 * @param {BasicAi} ai
 * @param {string} seat
 * @returns {{ command: Readonly<Record<string, unknown>>, fallback: boolean }} the command the engine ran
 */
function decide(engine, ai, seat) {
  const view = engine.getSnapshot(/** @type {"s0" | "s1"} */ (seat));
  const chosen = ai.decide(view);
  if (chosen !== null) {
    const command = { ...chosen, playerId: seat };
    if (engine.execute(command).ok) {
      return { command, fallback: false };
    }
  }
  const command = { ...forcedCommandFor(/** @type {any} */ (view)), playerId: seat };
  const result = engine.execute(command);
  if (!result.ok) {
    throw new Error(`auto game: even the smallest move was refused (${result.error.message})`);
  }
  return { command, fallback: true };
}
