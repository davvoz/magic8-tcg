/**
 * The smallest move the server may make for a seat that does not act
 * (docs/tcg/03-game-blockchain-protocol.md §7, FORCED_MOVE): no attack, no
 * block, otherwise end the turn, or at least the phase. The server never
 * plays a card or chooses a target for anyone.
 */
import { CommandType } from "@magic8/engine/domain/commands/CommandType.js";
import { GamePhase } from "@magic8/engine/domain/game/GamePhase.js";

/**
 * @param {{ phase: string, legalMoves: { canEndTurn: boolean, canEndPhase: boolean } }} snapshot the seat's own snapshot
 * @returns {Readonly<Record<string, unknown>>} a command without playerId
 */
export function forcedCommandFor(snapshot) {
  if (snapshot.phase === GamePhase.COMBAT_BLOCKERS) {
    return Object.freeze({ type: CommandType.DECLARE_BLOCKERS, blocks: [] });
  }
  if (snapshot.phase === GamePhase.COMBAT_ATTACKERS) {
    return Object.freeze({ type: CommandType.DECLARE_ATTACKERS, attackerIds: [] });
  }
  if (snapshot.legalMoves.canEndTurn) {
    return Object.freeze({ type: CommandType.END_TURN });
  }
  return Object.freeze(snapshot.legalMoves.canEndPhase ? { type: CommandType.END_PHASE } : { type: CommandType.CONCEDE });
}

/** A forfeit, for abandonment. */
export const CONCEDE_COMMAND = Object.freeze({ type: CommandType.CONCEDE });
