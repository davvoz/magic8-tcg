/**
 * Query: what may a given player do right now? The single source of truth
 * for UI highlighting and AI decisions. It reuses the same predicates the
 * command handlers use, so what is shown as legal is what the engine accepts.
 */
import { legalAttackers, legalBlockers } from "../combat/CombatSystem.js";
import { CommandType } from "../commands/CommandType.js";
import { phaseEntry } from "../turn/PhaseTable.js";
import { playabilityProblem, targetOptionsFor } from "./Playability.js";

/**
 * @typedef {Readonly<{
 *   canEndPhase: boolean,
 *   canEndTurn: boolean,
 *   canConcede: boolean,
 *   playableCardIds: readonly string[],
 *   targetOptions: Readonly<Record<string, readonly (readonly string[])[]>>,
 *   attackerIds: readonly string[],
 *   blockerIds: readonly string[],
 * }>} LegalMoves
 */

/** @type {LegalMoves} */
export const NO_MOVES = Object.freeze({
  canEndPhase: false,
  canEndTurn: false,
  canConcede: false,
  playableCardIds: Object.freeze([]),
  targetOptions: Object.freeze({}),
  attackerIds: Object.freeze([]),
  blockerIds: Object.freeze([]),
});

/**
 * @param {import("./GameState.js").GameState} state
 * @param {string} playerId
 * @param {import("./GameRules.js").GameRules} rules
 * @returns {LegalMoves}
 */
export function computeLegalMoves(state, playerId, rules) {
  const player = state.getPlayer(playerId);
  if (state.isOver || player === undefined) {
    return NO_MOVES;
  }
  const allows = state.awaitingPlayerId === playerId ? phaseEntry(state.phase).allows : [];
  const playable = allows.includes(CommandType.PLAY_CARD) ? playableCards(state, player, rules) : [];
  return Object.freeze({
    canEndPhase: allows.includes(CommandType.END_PHASE),
    canEndTurn: allows.includes(CommandType.END_TURN),
    canConcede: true,
    playableCardIds: Object.freeze(playable.map((card) => card.instanceId)),
    targetOptions: Object.freeze(Object.fromEntries(playable.map((card) => [card.instanceId, targetOptionsFor(state, card)]))),
    attackerIds: Object.freeze(allows.includes(CommandType.DECLARE_ATTACKERS) ? legalAttackers(player).map((card) => card.instanceId) : []),
    blockerIds: Object.freeze(allows.includes(CommandType.DECLARE_BLOCKERS) ? legalBlockers(player).map((card) => card.instanceId) : []),
  });
}

/**
 * @param {import("./GameState.js").GameState} state
 * @param {import("./Player.js").Player} player
 * @param {import("./GameRules.js").GameRules} rules
 */
function playableCards(state, player, rules) {
  return player.hand.cards.filter((card) => playabilityProblem(state, player, card, rules) === null);
}
