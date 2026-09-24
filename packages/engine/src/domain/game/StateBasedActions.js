/**
 * Checks that run after every command and every effect resolution until the
 * state is stable: lethally damaged creatures die, players at zero life lose.
 * Bounded so a pathological loop can never hang the engine.
 */
import { GameEndReason, GameEventType } from "./GameEventType.js";

const MAX_PASSES = 100;

/**
 * @param {import("./GameState.js").GameState} state
 * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
 * @returns {readonly import("../cards/CardInstance.js").CardInstance[]} creatures that died during this run, in order
 */
export function runStateBasedActions(state, context) {
  /** @type {import("../cards/CardInstance.js").CardInstance[]} */
  const died = [];
  let passes = 0;
  let changed = true;
  while (changed && !state.isOver) {
    if (passes >= MAX_PASSES) {
      throw new RangeError("StateBasedActions: did not settle");
    }
    changed = buryLethallyDamaged(state, context, died) || checkLifeTotals(state, context);
    passes += 1;
  }
  return Object.freeze(died);
}

/**
 * @param {import("./GameState.js").GameState} state
 * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
 * @param {import("../cards/CardInstance.js").CardInstance[]} died
 * @returns {boolean} whether anything changed
 */
function buryLethallyDamaged(state, context, died) {
  let changed = false;
  for (const player of state.players) {
    for (const card of player.battlefield.cards.filter((candidate) => candidate.isLethallyDamaged)) {
      player.battlefield.remove(card.instanceId);
      player.graveyard.add(card);
      died.push(card);
      context.events.emit(GameEventType.CREATURE_DIED, { playerId: player.id, instanceId: card.instanceId, definitionId: card.definitionId });
      changed = true;
    }
  }
  return changed;
}

/**
 * @param {import("./GameState.js").GameState} state
 * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
 * @returns {boolean} whether the game ended
 */
function checkLifeTotals(state, context) {
  const defeated = state.players.filter((player) => player.life <= 0);
  if (defeated.length === 0) {
    return false;
  }
  if (defeated.length === state.players.length) {
    state.endGame(null, GameEndReason.DRAW);
  } else {
    state.endGame(state.opponentOf(defeated[0].id).id, GameEndReason.LIFE_DEPLETED);
  }
  context.events.emit(GameEventType.GAME_ENDED, { winnerId: state.winnerId, reason: state.endReason });
  return true;
}
