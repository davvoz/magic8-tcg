import { ok } from "../../../shared/Result.js";
import { CommandType } from "../CommandType.js";

/**
 * END_TURN: skip the remaining phases of the active player's turn.
 * @type {import("../CommandHandler.contract.js").CommandHandler}
 */
export const endTurnHandler = Object.freeze({
  type: CommandType.END_TURN,
  requiresPriority: true,
  validate: () => ok(undefined),
  execute: (state, _command, context) => {
    context.turnManager.endTurn(state, context);
  },
});
