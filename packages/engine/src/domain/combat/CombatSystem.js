/**
 * Combat rules: who may attack or block, whether a set of blocks is legal,
 * and how combat damage is dealt. Pure functions over GameState so the
 * handlers, LegalMoves and the COMBAT_DAMAGE phase work all share one
 * definition of legality.
 *
 * Slice rules: attackers become exhausted when declared and stay so until
 * their controller's next turn (so they cannot block meanwhile); a blocker
 * blocks exactly one attacker; unblocked attackers hit the defending player;
 * a blocked attacker splits its damage across its blockers in declaration
 * order, lethal to each before moving on, and takes damage from all of them.
 */
import { GameEventType } from "../game/GameEventType.js";

/**
 * @param {import("../game/Player.js").Player} player
 * @returns {import("../cards/CardInstance.js").CardInstance[]}
 */
export function legalAttackers(player) {
  return player.creatures.filter((card) => !card.exhausted && !card.summoningSick);
}

/**
 * @param {import("../game/Player.js").Player} defender
 * @returns {import("../cards/CardInstance.js").CardInstance[]}
 */
export function legalBlockers(defender) {
  return defender.creatures.filter((card) => !card.exhausted);
}

/**
 * @param {import("../game/Player.js").Player} player
 * @param {readonly string[]} attackerIds
 * @returns {string | null} problem, or null when legal
 */
export function validateAttackers(player, attackerIds) {
  if (new Set(attackerIds).size !== attackerIds.length) {
    return "attackers must be distinct";
  }
  const legal = legalAttackers(player).map((card) => card.instanceId);
  const illegal = attackerIds.find((id) => !legal.includes(id));
  return illegal === undefined ? null : `"${illegal}" cannot attack`;
}

/**
 * @param {import("../game/GameState.js").GameState} state
 * @param {import("../game/Player.js").Player} defender
 * @param {readonly Readonly<{ attackerId: string, blockerId: string }>[]} blocks
 * @param {import("../game/GameRules.js").GameRules} rules
 * @returns {string | null} problem, or null when legal
 */
export function validateBlocks(state, defender, blocks, rules) {
  const blockerIds = blocks.map((block) => block.blockerId);
  if (new Set(blockerIds).size !== blockerIds.length) {
    return "a creature can block only one attacker";
  }
  const legal = legalBlockers(defender).map((card) => card.instanceId);
  const illegalBlocker = blockerIds.find((id) => !legal.includes(id));
  if (illegalBlocker !== undefined) {
    return `"${illegalBlocker}" cannot block`;
  }
  const illegalAttacker = blocks.find((block) => !state.combat.attackerIds.includes(block.attackerId));
  if (illegalAttacker !== undefined) {
    return `"${illegalAttacker.attackerId}" is not attacking`;
  }
  const perAttacker = new Map();
  for (const block of blocks) {
    perAttacker.set(block.attackerId, (perAttacker.get(block.attackerId) ?? 0) + 1);
  }
  const overBlocked = [...perAttacker.values()].some((count) => count > rules.combat.maxBlockersPerAttacker);
  return overBlocked ? `at most ${rules.combat.maxBlockersPerAttacker} blocker(s) per attacker` : null;
}

/**
 * COMBAT_DAMAGE phase work. Deaths are handled by the caller's settle().
 * @param {import("../game/GameState.js").GameState} state
 * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
 */
export function resolveCombatDamage(state, context) {
  const attacker = state.activePlayer;
  const defender = state.opponentOf(attacker.id);
  for (const attackerId of state.combat.attackerIds) {
    const card = attacker.battlefield.find(attackerId);
    if (card === undefined) {
      continue;
    }
    const blockers = state.combat.blockersOf(attackerId).map((id) => defender.battlefield.find(id)).filter((blocker) => blocker !== undefined);
    if (state.combat.blockersOf(attackerId).length === 0) {
      hitPlayer(card, defender, context);
    } else {
      exchangeDamage(card, blockers, context);
    }
  }
  state.combat.clear();
}

/**
 * @param {import("../cards/CardInstance.js").CardInstance} attacker
 * @param {import("../game/Player.js").Player} defender
 * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
 */
function hitPlayer(attacker, defender, context) {
  const lost = defender.loseLife(attacker.attack);
  context.events.emit(GameEventType.DAMAGE_DEALT, { sourceId: attacker.instanceId, targetId: defender.id, amount: lost });
  context.events.emit(GameEventType.LIFE_CHANGED, { playerId: defender.id, life: defender.life, delta: -lost });
}

/**
 * @param {import("../cards/CardInstance.js").CardInstance} attacker
 * @param {readonly import("../cards/CardInstance.js").CardInstance[]} blockers
 * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
 */
function exchangeDamage(attacker, blockers, context) {
  let remaining = attacker.attack;
  blockers.forEach((blocker, index) => {
    const isLast = index === blockers.length - 1;
    const amount = isLast ? remaining : Math.min(remaining, Math.max(0, blocker.health));
    remaining -= amount;
    const applied = blocker.takeDamage(amount);
    context.events.emit(GameEventType.DAMAGE_DEALT, { sourceId: attacker.instanceId, targetId: blocker.instanceId, amount: applied, remainingHealth: blocker.health });
    const returned = attacker.takeDamage(blocker.attack);
    context.events.emit(GameEventType.DAMAGE_DEALT, { sourceId: blocker.instanceId, targetId: attacker.instanceId, amount: returned, remainingHealth: attacker.health });
  });
}
