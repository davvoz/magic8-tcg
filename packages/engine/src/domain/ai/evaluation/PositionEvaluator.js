/**
 * Scores a position for one player: higher is better for them. The search
 * AI compares the positions its candidate moves lead to with this, so the
 * score only has to rank positions well, not mean anything absolute.
 *
 * A finished game is a win or a loss, far beyond any material (a quicker
 * win and a later loss rank higher). Otherwise the score is material (life,
 * creatures, cards in hand, each side's) plus the outlook of the next
 * combats: the damage the enemy would get through next, and the damage the
 * player would. Everything is weighted by the AI's character
 * (EvaluationWeights).
 *
 * Life counts on a curve: a point of life is worth more the less is left,
 * so the AI trades life freely at 20 and guards it at 5, and burns the
 * enemy's face when it is low rather than when it is high.
 */
import { AttackForecast } from "./AttackForecast.js";
import { CardValuer } from "./CardValuer.js";

/** @typedef {import("../AiPolicy.contract.js").Snapshot} Snapshot */
/** @typedef {Snapshot["players"][number]} PlayerView */

/** A won game; beyond any material difference. */
export const WIN_SCORE = 10000;
/** A drawn game: better than losing, worse than any game still going. */
const DRAW_SCORE = -WIN_SCORE / 10;
/** Scale of the life curve: one point of life at 20 is worth about 0.7, at 5 about 1.4. */
const LIFE_SCALE = 6.3;

export class PositionEvaluator {
  #weights;
  #valuer;

  /**
   * @param {{ weights: import("./EvaluationWeights.js").EvaluationWeights, valuer?: CardValuer }} deps
   */
  constructor({ weights, valuer = new CardValuer() }) {
    this.#weights = weights;
    this.#valuer = valuer;
  }

  /**
   * @param {Snapshot} snapshot any snapshot that shows the player's own hand
   * @param {string} playerId whose position it is
   * @returns {number}
   */
  evaluate(snapshot, playerId) {
    if (snapshot.isOver) {
      return outcome(snapshot, playerId);
    }
    const me = snapshot.players.find((player) => player.id === playerId);
    const enemy = snapshot.players.find((player) => player.id !== playerId);
    if (me === undefined || enemy === undefined) {
      throw new RangeError(`PositionEvaluator: "${playerId}" does not play this game`);
    }
    return this.#material(me, enemy) + this.#outlook(snapshot, me, enemy);
  }

  /**
   * @param {PlayerView} me
   * @param {PlayerView} enemy
   */
  #material(me, enemy) {
    const weights = this.#weights;
    const valuer = this.#valuer;
    const life = weights.life * lifeValue(me.life) - weights.enemyLife * lifeValue(enemy.life);
    const board = weights.board * sum(me.battlefield, (card) => valuer.creature(card)) - weights.enemyBoard * sum(enemy.battlefield, (card) => valuer.creature(card));
    const hand = weights.hand * sum(me.hand ?? [], (card) => valuer.inHand(card)) - weights.enemyHand * enemy.handSize * valuer.unknownInHand;
    return life + board + hand;
  }

  /**
   * @param {Snapshot} snapshot
   * @param {PlayerView} me
   * @param {PlayerView} enemy
   */
  #outlook(snapshot, me, enemy) {
    const weights = this.#weights;
    const incoming = AttackForecast.unblockedDamage(snapshot, enemy, me);
    const outgoing = AttackForecast.unblockedDamage(snapshot, me, enemy);
    const threat = weights.threat * incoming + (incoming >= me.life ? weights.lethalThreat : 0);
    const pressure = weights.pressure * outgoing + (outgoing >= enemy.life ? weights.lethalPressure : 0);
    return pressure - threat;
  }
}

/**
 * @param {Snapshot} snapshot a finished game
 * @param {string} playerId
 */
function outcome(snapshot, playerId) {
  if (snapshot.winnerId === null) {
    return DRAW_SCORE;
  }
  return snapshot.winnerId === playerId ? WIN_SCORE - snapshot.turnNumber : snapshot.turnNumber - WIN_SCORE;
}

/** @param {number} life */
function lifeValue(life) {
  return LIFE_SCALE * Math.sqrt(Math.max(0, life));
}

/**
 * @template T
 * @param {readonly T[]} items
 * @param {(item: T) => number} value
 */
function sum(items, value) {
  return items.reduce((total, item) => total + value(item), 0);
}
