/**
 * How much each part of a position is worth to the search AI: its
 * character. The level (how well it searches) is separate (DifficultyScale);
 * a character is a set of weights, so an aggressive opponent and a careful
 * one see the same board differently and play it differently.
 *
 * One weight set per AI style, the same styles BasicAi knows, so a seat
 * keeps its style whichever AI plays it.
 */
import { AI_STYLES, AiStyle } from "../BasicAi.js";

/**
 * - life / enemyLife: own and enemy life (on a curve: life is worth more when low, see PositionEvaluator)
 * - board / enemyBoard: own and enemy creatures (CardValuer)
 * - hand / enemyHand: own cards in hand and the enemy's unknown ones
 * - threat: per point of damage the enemy's next attack would get through
 * - lethalThreat: when that damage would kill
 * - pressure: per point of damage its own next attack would get through
 * - lethalPressure: when that damage would kill
 * @typedef {Readonly<{
 *   life: number, enemyLife: number, board: number, enemyBoard: number, hand: number, enemyHand: number,
 *   threat: number, lethalThreat: number, pressure: number, lethalPressure: number,
 * }>} EvaluationWeights
 */

/** @type {EvaluationWeights} */
const BALANCED = Object.freeze({
  life: 1,
  enemyLife: 1,
  board: 1,
  enemyBoard: 1,
  hand: 1,
  enemyHand: 1,
  threat: 0.6,
  lethalThreat: 30,
  pressure: 0.3,
  lethalPressure: 6,
});

/** @type {Readonly<Record<string, EvaluationWeights>>} */
const BY_STYLE = Object.freeze({
  [AiStyle.BALANCED]: BALANCED,
  [AiStyle.AGGRESSIVE]: Object.freeze({ ...BALANCED, life: 0.8, enemyLife: 1.4, threat: 0.4, pressure: 0.6, lethalPressure: 10 }),
  [AiStyle.DEFENSIVE]: Object.freeze({ ...BALANCED, life: 1.3, enemyLife: 0.9, threat: 0.9, pressure: 0.2, lethalThreat: 40 }),
});

/**
 * @param {string} style one of AiStyle
 * @returns {EvaluationWeights}
 */
export function weightsFor(style) {
  const weights = BY_STYLE[style];
  if (weights === undefined) {
    throw new TypeError(`unknown AI style "${style}"; expected one of ${AI_STYLES.join(", ")}`);
  }
  return weights;
}
