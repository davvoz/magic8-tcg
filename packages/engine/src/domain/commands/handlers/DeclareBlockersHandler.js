/**
 * DECLARE_BLOCKERS: the defending player assigns ready creatures to
 * attackers. An empty declaration lets every attacker through.
 */
import { fail, ok } from "../../../shared/Result.js";
import { validateBlocks } from "../../combat/CombatSystem.js";
import { GameEventType } from "../../game/GameEventType.js";
import { CommandError } from "../CommandError.js";
import { CommandType } from "../CommandType.js";

/** @typedef {Readonly<{ attackerId: string, blockerId: string }>} Block */

/** @type {import("../CommandHandler.contract.js").CommandHandler} */
export const declareBlockersHandler = Object.freeze({
  type: CommandType.DECLARE_BLOCKERS,
  requiresPriority: true,

  validate(state, command, context) {
    const defender = state.requirePlayer(/** @type {string} */ (command.playerId));
    const problem = validateBlocks(state, defender, /** @type {readonly Block[]} */ (command.blocks), context.rules);
    return problem === null ? ok(undefined) : fail(CommandError.INVALID_TARGET, problem);
  },

  execute(state, command, context) {
    const blocks = /** @type {readonly Block[]} */ (command.blocks);
    state.combat.declareBlocks(blocks);
    context.events.emit(GameEventType.BLOCKERS_DECLARED, {
      playerId: command.playerId,
      blocks: Object.freeze(blocks.map((block) => Object.freeze({ ...block }))),
    });
    context.turnManager.advance(state, context);
  },
});
