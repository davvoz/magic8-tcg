import { ok } from "../../../shared/Result.js";
import { CommandType } from "../CommandType.js";

/**
 * END_PHASE: proceed to the next phase. In COMBAT_ATTACKERS it means
 * "attack with nothing", which skips the rest of combat.
 * Phase/actor legality is checked by the engine before validate() is called.
 * @type {import("../CommandHandler.contract.js").CommandHandler}
 */
export const endPhaseHandler = Object.freeze({
  type: CommandType.END_PHASE,
  requiresPriority: true,
  validate: () => ok(undefined),
  execute: (state, _command, context) => {
    context.turnManager.advance(state, context);
  },
});
