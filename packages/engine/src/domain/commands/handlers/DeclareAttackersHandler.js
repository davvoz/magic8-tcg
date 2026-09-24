/**
 * DECLARE_ATTACKERS: the active player chooses which ready creatures attack.
 * An empty declaration is equivalent to END_PHASE; combat is skipped.
 */
import { fail, ok } from "../../../shared/Result.js";
import { validateAttackers } from "../../combat/CombatSystem.js";
import { GameEventType } from "../../game/GameEventType.js";
import { CommandError } from "../CommandError.js";
import { CommandType } from "../CommandType.js";

/** @type {import("../CommandHandler.contract.js").CommandHandler} */
export const declareAttackersHandler = Object.freeze({
  type: CommandType.DECLARE_ATTACKERS,
  requiresPriority: true,

  validate(state, command) {
    const player = state.requirePlayer(/** @type {string} */ (command.playerId));
    const problem = validateAttackers(player, /** @type {readonly string[]} */ (command.attackerIds));
    return problem === null ? ok(undefined) : fail(CommandError.INVALID_TARGET, problem);
  },

  execute(state, command, context) {
    const player = state.requirePlayer(/** @type {string} */ (command.playerId));
    const attackerIds = /** @type {readonly string[]} */ (command.attackerIds);
    for (const id of attackerIds) {
      const card = player.battlefield.find(id);
      if (card === undefined) {
        throw new Error(`DeclareAttackersHandler: attacker "${id}" vanished`);
      }
      card.exhausted = true;
    }
    state.combat.declareAttackers(attackerIds);
    context.events.emit(GameEventType.ATTACKERS_DECLARED, { playerId: player.id, attackerIds: Object.freeze([...attackerIds]) });
    context.turnManager.advance(state, context);
  },
});
