/**
 * Builders for command objects. Commands are frozen plain data so they can be
 * produced by input handlers, AI controllers, network peers or replay files
 * alike, and are always re-validated by the engine (validateCommandShape).
 */
import { CommandType } from "./CommandType.js";

/**
 * @param {string} playerId
 * @param {string} cardId
 * @param {readonly string[]} [targets]
 */
export function playCard(playerId, cardId, targets = []) {
  return Object.freeze({ type: CommandType.PLAY_CARD, playerId, cardId, targets: Object.freeze([...targets]) });
}

/**
 * @param {string} playerId
 * @param {readonly string[]} attackerIds
 */
export function declareAttackers(playerId, attackerIds) {
  return Object.freeze({ type: CommandType.DECLARE_ATTACKERS, playerId, attackerIds: Object.freeze([...attackerIds]) });
}

/**
 * @param {string} playerId
 * @param {readonly { attackerId: string, blockerId: string }[]} blocks
 */
export function declareBlockers(playerId, blocks) {
  return Object.freeze({
    type: CommandType.DECLARE_BLOCKERS,
    playerId,
    blocks: Object.freeze(blocks.map((block) => Object.freeze({ attackerId: block.attackerId, blockerId: block.blockerId }))),
  });
}

/** @param {string} playerId */
export function endPhase(playerId) {
  return Object.freeze({ type: CommandType.END_PHASE, playerId });
}

/** @param {string} playerId */
export function endTurn(playerId) {
  return Object.freeze({ type: CommandType.END_TURN, playerId });
}

/** @param {string} playerId */
export function concede(playerId) {
  return Object.freeze({ type: CommandType.CONCEDE, playerId });
}
