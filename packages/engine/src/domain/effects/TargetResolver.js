/**
 * Turns a TargetSpec into concrete candidates, validates a player's chosen
 * targets against it, and resolves automatic targets. Used by LegalMoves
 * (what can be targeted), PlayCardHandler (validate the command) and the
 * TriggerDispatcher (automatic targets for on_death).
 */
import { ZoneType } from "../game/ZoneType.js";
import { TargetOwner } from "./TargetSpec.js";

/**
 * @typedef {object} TargetScope
 * @property {string} controllerId Player who controls the ability's source.
 * @property {string | null} [excludeId] Instance id that may not be targeted (the source itself).
 */

/**
 * @param {string} owner One of TargetOwner.
 * @param {string} candidateControllerId
 * @param {string} controllerId
 */
function ownerMatches(owner, candidateControllerId, controllerId) {
  if (owner === TargetOwner.ANY) {
    return true;
  }
  const isAlly = candidateControllerId === controllerId;
  return owner === TargetOwner.ALLY ? isAlly : !isAlly;
}

/**
 * Ids of everything the spec could legally target right now, creatures first.
 * @param {import("../game/GameState.js").GameState} state
 * @param {import("./TargetSpec.js").TargetSpec} spec
 * @param {TargetScope} scope
 * @returns {string[]}
 */
export function candidatesFor(state, spec, scope) {
  const candidates = [];
  if (spec.allowsCreatures) {
    for (const player of state.players) {
      if (ownerMatches(spec.owner, player.id, scope.controllerId)) {
        candidates.push(...player.creatures.map((card) => card.instanceId).filter((id) => id !== scope.excludeId));
      }
    }
  }
  if (spec.allowsPlayers) {
    candidates.push(...state.players.filter((player) => ownerMatches(spec.owner, player.id, scope.controllerId)).map((player) => player.id));
  }
  return candidates;
}

/**
 * Validates targets a player chose for one ability.
 * @param {import("../game/GameState.js").GameState} state
 * @param {import("./TargetSpec.js").TargetSpec} spec
 * @param {readonly string[]} targetIds
 * @param {TargetScope} scope
 * @returns {string | null} problem description, or null when valid
 */
export function validateChosenTargets(state, spec, targetIds, scope) {
  if (targetIds.length !== spec.count) {
    return `expected ${spec.count} target(s), got ${targetIds.length}`;
  }
  if (new Set(targetIds).size !== targetIds.length) {
    return "targets must be distinct";
  }
  const candidates = candidatesFor(state, spec, scope);
  const illegal = targetIds.find((id) => !candidates.includes(id));
  return illegal === undefined ? null : `"${illegal}" is not a legal target`;
}

/**
 * Targets for a spec that needs no player decision (see TargetSpec.isAutomatic).
 * @param {import("../game/GameState.js").GameState} state
 * @param {import("./TargetSpec.js").TargetSpec} spec
 * @param {TargetScope} scope
 * @returns {string[]}
 */
export function resolveAutomaticTargets(state, spec, scope) {
  if (!spec.isAutomatic) {
    throw new TypeError("resolveAutomaticTargets: spec requires a player decision");
  }
  return candidatesFor(state, spec, scope);
}

/**
 * Materialises target ids at resolution time. Targets that no longer exist
 * (a creature that died meanwhile) are silently dropped: the effect fizzles
 * for them.
 * @param {import("../game/GameState.js").GameState} state
 * @param {readonly string[]} targetIds
 * @returns {{ creatures: import("../cards/CardInstance.js").CardInstance[], players: import("../game/Player.js").Player[] }}
 */
export function materialiseTargets(state, targetIds) {
  const creatures = [];
  const players = [];
  for (const id of targetIds) {
    const player = state.getPlayer(id);
    if (player !== undefined) {
      players.push(player);
      continue;
    }
    const found = state.findCard(id);
    if (found !== undefined && found.card.zone === ZoneType.BATTLEFIELD && found.card.isCreature) {
      creatures.push(found.card);
    }
  }
  return { creatures, players };
}
