/**
 * Collects the abilities that fire for a trigger and enqueues them as
 * pending effects. Player-chosen targets come from the command (on_play,
 * on_cast); other triggers (on_death, on_turn_start) resolve their targets
 * automatically.
 */
import { GameEventType } from "../game/GameEventType.js";
import { createPendingEffect } from "./PendingEffect.js";
import { resolveAutomaticTargets } from "./TargetResolver.js";
import { TriggerType } from "./TriggerType.js";

/**
 * The trigger that fires when a card of this definition is played.
 * @param {import("../cards/CardDefinition.js").CardDefinition} definition
 */
export function playTriggerFor(definition) {
  return definition.isCreature ? TriggerType.ON_PLAY : TriggerType.ON_CAST;
}

/**
 * Enqueues the play-time abilities of `card`. `chosenTargets` holds one
 * array per player-targeted ability, in ability order (see Playability).
 * @param {import("../cards/CardInstance.js").CardInstance} card
 * @param {readonly (readonly string[])[]} chosenTargets
 * @param {import("../game/GameState.js").GameState} state
 * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
 */
export function enqueuePlayTriggers(card, chosenTargets, state, context) {
  let chosenIndex = 0;
  for (const ability of card.definition.abilitiesFor(playTriggerFor(card.definition))) {
    let targetIds = [];
    if (ability.target?.isAutomatic) {
      targetIds = resolveAutomaticTargets(state, ability.target, { controllerId: card.controllerId, excludeId: card.instanceId });
    } else if (ability.target !== null) {
      targetIds = chosenTargets[chosenIndex] ?? [];
      chosenIndex += 1;
    }
    enqueue(ability, card, targetIds, context);
  }
}

/**
 * @param {readonly import("../cards/CardInstance.js").CardInstance[]} died
 * @param {import("../game/GameState.js").GameState} state
 * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
 */
export function enqueueDeathTriggers(died, state, context) {
  enqueueAutomaticTriggers(died, TriggerType.ON_DEATH, state, context);
}

/**
 * Enqueues the on_turn_start abilities of every creature the active player
 * controls, in battlefield order. Called by the TurnManager once the
 * start-of-turn draw is done.
 * @param {import("../game/GameState.js").GameState} state
 * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
 */
export function enqueueTurnStartTriggers(state, context) {
  enqueueAutomaticTriggers(state.activePlayer.creatures, TriggerType.ON_TURN_START, state, context);
}

/**
 * Triggers that fire outside a player's own command: their targets are
 * resolved automatically (validated as such at content load).
 * @param {readonly import("../cards/CardInstance.js").CardInstance[]} sources
 * @param {string} trigger
 * @param {import("../game/GameState.js").GameState} state
 * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
 */
function enqueueAutomaticTriggers(sources, trigger, state, context) {
  for (const card of sources) {
    for (const ability of card.definition.abilitiesFor(trigger)) {
      const targetIds = ability.target === null ? [] : resolveAutomaticTargets(state, ability.target, { controllerId: card.controllerId });
      enqueue(ability, card, targetIds, context);
    }
  }
}

/**
 * An ability that needs a target and found none does not fire at all: it is
 * neither queued nor announced (Playability holds back the cards for which
 * that would be a free ride).
 * @param {import("../cards/Ability.js").Ability} ability
 * @param {import("../cards/CardInstance.js").CardInstance} source
 * @param {readonly string[]} targetIds
 * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
 */
function enqueue(ability, source, targetIds, context) {
  if (ability.requiresTarget && targetIds.length === 0) {
    return;
  }
  context.queue.enqueue(createPendingEffect({ ability, source, targetIds }));
  context.events.emit(GameEventType.ABILITY_TRIGGERED, {
    sourceId: source.instanceId,
    definitionId: source.definitionId,
    trigger: ability.trigger,
    effect: ability.effect,
    targetIds: Object.freeze([...targetIds]),
  });
}
