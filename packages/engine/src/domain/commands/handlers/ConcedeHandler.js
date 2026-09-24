import { ok } from "../../../shared/Result.js";
import { GameEndReason, GameEventType } from "../../game/GameEventType.js";
import { CommandType } from "../CommandType.js";

/**
 * CONCEDE: either player may resign at any time while the game is running.
 * @type {import("../CommandHandler.contract.js").CommandHandler}
 */
export const concedeHandler = Object.freeze({
  type: CommandType.CONCEDE,
  requiresPriority: false,
  validate: () => ok(undefined),
  execute: (state, command, context) => {
    const playerId = /** @type {string} */ (command.playerId);
    const winnerId = state.opponentOf(playerId).id;
    state.endGame(winnerId, GameEndReason.CONCEDE);
    context.events.emit(GameEventType.PLAYER_CONCEDED, { playerId });
    context.events.emit(GameEventType.GAME_ENDED, { winnerId, reason: GameEndReason.CONCEDE });
  },
});
