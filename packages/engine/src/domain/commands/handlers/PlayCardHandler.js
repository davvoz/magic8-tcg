/**
 * PLAY_CARD: pay the cost, move a card from hand to the battlefield
 * (creature) or graveyard (spell), and enqueue its play-time abilities.
 * Effects resolve afterwards through ExecutionContext.settle.
 */
import { fail, ok } from "../../../shared/Result.js";
import { Keyword } from "../../effects/Keyword.js";
import { enqueuePlayTriggers } from "../../effects/TriggerDispatcher.js";
import { GameEventType } from "../../game/GameEventType.js";
import { playabilityProblem, splitChosenTargets } from "../../game/Playability.js";
import { ZoneType } from "../../game/ZoneType.js";
import { CommandError } from "../CommandError.js";
import { CommandType } from "../CommandType.js";

/**
 * @param {import("../../game/GameState.js").GameState} state
 * @param {Readonly<Record<string, unknown>>} command
 * @returns {{ player: import("../../game/Player.js").Player, card: import("../../cards/CardInstance.js").CardInstance } | null}
 */
function locate(state, command) {
  const player = state.getPlayer(/** @type {string} */ (command.playerId));
  const card = player?.hand.find(/** @type {string} */ (command.cardId));
  return player === undefined || card === undefined ? null : { player, card };
}

/** @type {import("../CommandHandler.contract.js").CommandHandler} */
export const playCardHandler = Object.freeze({
  type: CommandType.PLAY_CARD,
  requiresPriority: true,

  validate(state, command, context) {
    const located = locate(state, command);
    if (located === null) {
      return fail(CommandError.CARD_NOT_FOUND, `card "${command.cardId}" is not in your hand`);
    }
    const problem = playabilityProblem(state, located.player, located.card, context.rules);
    if (problem !== null) {
      return fail(problem.code, problem.message);
    }
    const targets = splitChosenTargets(state, located.card, /** @type {readonly string[]} */ (command.targets));
    if ("code" in targets) {
      return fail(targets.code, targets.message);
    }
    return ok(undefined);
  },

  execute(state, command, context) {
    const located = locate(state, command);
    if (located === null) {
      throw new Error("PlayCardHandler: card vanished between validate and execute");
    }
    const { player, card } = located;
    const targets = splitChosenTargets(state, card, /** @type {readonly string[]} */ (command.targets));
    if ("code" in targets) {
      throw new Error(`PlayCardHandler: ${targets.message}`);
    }
    player.resources.spend(card.definition.cost);
    context.events.emit(GameEventType.RESOURCES_CHANGED, { playerId: player.id, current: player.resources.current, max: player.resources.max });
    player.hand.remove(card.instanceId);
    const destination = card.isCreature ? ZoneType.BATTLEFIELD : ZoneType.GRAVEYARD;
    player.zone(destination).add(card);
    if (card.isCreature) {
      card.summoningSick = context.rules.combat.summoningSickness && !card.definition.hasKeyword(Keyword.HASTE);
    }
    context.events.emit(GameEventType.CARD_PLAYED, {
      playerId: player.id,
      instanceId: card.instanceId,
      definitionId: card.definitionId,
      zone: destination,
      targetIds: Object.freeze(targets.groups.flat()),
    });
    enqueuePlayTriggers(card, targets.groups, state, context);
  },
});
