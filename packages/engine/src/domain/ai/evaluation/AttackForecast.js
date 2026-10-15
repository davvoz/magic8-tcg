/**
 * A quick look at the next combat between two sides: how much damage the
 * attacker would get through if every defender able to block took one
 * attacker, biggest first (what a defender facing lethal does). It ignores
 * tricks the other side may still hold; the evaluation only needs to know
 * which positions leave a player exposed and which put the enemy on a clock.
 */
import { GamePhase } from "../../game/GamePhase.js";

/** @typedef {import("../AiPolicy.contract.js").Snapshot} Snapshot */
/** @typedef {Snapshot["players"][number]} PlayerView */
/** @typedef {import("../../game/GameSnapshot.js").CardView} CardView */

/** Phases of a turn whose combat has not happened yet. */
const BEFORE_COMBAT = Object.freeze(/** @type {string[]} */ ([GamePhase.TURN_START, GamePhase.MAIN_1, GamePhase.COMBAT_ATTACKERS]));

export class AttackForecast {
  /**
   * Damage `attacker` gets through in its next combat against `defender`.
   * @param {Snapshot} snapshot
   * @param {PlayerView} attacker
   * @param {PlayerView} defender
   * @returns {number}
   */
  static unblockedDamage(snapshot, attacker, defender) {
    const strikesThisTurn = snapshot.activePlayerId === attacker.id && BEFORE_COMBAT.includes(snapshot.phase);
    const attackers = strikesThisTurn ? attacker.battlefield.filter(canAttackNow) : attacker.battlefield;
    // Before the attacker's next turn the defender readies everything unless that turn is this one
    // (or the defender plays first and its exhausted creatures stay so until its own next turn).
    const defenderReadies = snapshot.activePlayerId === attacker.id && !strikesThisTurn;
    const blockers = defenderReadies ? defender.battlefield : defender.battlefield.filter((card) => !card.exhausted);
    const strongestFirst = attackers.map((card) => card.attack).sort((a, b) => b - a);
    return strongestFirst.slice(blockers.length).reduce((sum, attack) => sum + attack, 0);
  }
}

/** @param {CardView} card */
function canAttackNow(card) {
  return !card.exhausted && !card.summoningSick;
}
