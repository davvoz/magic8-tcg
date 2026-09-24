/**
 * Complete, deterministic projection of a GameState as plain data.
 *
 * Unlike GameSnapshot (a perspective-filtered view for players), the digest
 * contains everything that determines the future of the match: library order,
 * random generator state, modifiers, instance counter, combat. Two states with
 * equal digests behave identically for every future command, so hashing the
 * digest (salted, see docs/tcg/03-game-blockchain-protocol.md §7) lets a
 * replay verifier check that a published checkpoint really follows from the
 * published moves.
 *
 * Only integers, strings, booleans, null, arrays and plain objects appear, so
 * the result can be serialised canonically. The digest reveals hidden
 * information and must never be sent to a player.
 */
import { deepFreeze } from "../../shared/deepFreeze.js";
import { ZONE_TYPES } from "./ZoneType.js";

/**
 * @param {import("../cards/CardInstance.js").CardInstance} card
 */
function digestCard(card) {
  return {
    id: card.instanceId,
    def: card.definitionId,
    owner: card.ownerId,
    controller: card.controllerId,
    damage: card.damage,
    sick: card.summoningSick,
    exhausted: card.exhausted,
    modifiers: card.modifiers.map((modifier) => ({ attack: modifier.attack, health: modifier.health, duration: modifier.duration })),
  };
}

/**
 * @param {import("./Player.js").Player} player
 */
function digestPlayer(player) {
  /** @type {Record<string, unknown>} */
  const zones = {};
  for (const type of ZONE_TYPES) {
    zones[type] = player.zone(type).cards.map(digestCard);
  }
  return {
    id: player.id,
    name: player.name,
    life: player.life,
    resources: { current: player.resources.current, max: player.resources.max },
    zones,
  };
}

/**
 * @param {import("./GameState.js").GameState} state
 * @returns {Readonly<Record<string, unknown>>}
 */
export function digestState(state) {
  return deepFreeze({
    version: state.version,
    turn: state.turnNumber,
    phase: state.phase,
    active: state.activePlayerId,
    awaiting: state.awaitingPlayerId,
    ended: state.ended,
    winner: state.winnerId,
    endReason: state.endReason,
    nextInstance: state.nextInstanceNumber,
    rng: { ...state.rng.getState() },
    combat: state.combat.toPlain(),
    players: state.players.map(digestPlayer),
  });
}
