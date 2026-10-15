/**
 * What a card is worth, in one currency for the whole evaluation: roughly
 * "points of attack and health". A creature on the battlefield is worth its
 * lasting stats (a buff until end of turn is not), its keywords and the
 * abilities it will still fire (on death, at turn start); a card in hand is
 * worth a flat amount plus a little per point of cost, since what matters is
 * that it is an option. An unknown card is worth an average card in hand.
 */
import { CardType } from "../../cards/CardType.js";
import { ModifierDuration } from "../../cards/CardInstance.js";
import { Keyword } from "../../effects/Keyword.js";
import { TriggerType } from "../../effects/TriggerType.js";
import { UNKNOWN_CARD_ID, hasKeyword } from "../cardViews.js";

/** @typedef {import("../../game/GameSnapshot.js").CardView} CardView */
/** @typedef {import("../../game/GameSnapshot.js").AbilityView} AbilityView */

const VALUE = Object.freeze({
  attack: 1,
  health: 1,
  /** Any body on the battlefield: it can block, it can be sacrificed. */
  body: 1,
  trample: 0.3,
  vigilance: 1,
  /** A card in hand, whatever it is. */
  handCard: 2.5,
  handCardPerCost: 0.3,
  /** The cost an unknown card in hand is assumed to have. */
  averageCost: 3,
  /** An ability that fires every turn is worth this many single firings. */
  recurring: 2,
});

/**
 * What one firing of an effect is worth, per unit of its amount (or flat).
 * @type {Readonly<Record<string, (params: Readonly<Record<string, number | string>>) => number>>}
 */
const EFFECT_VALUE = Object.freeze({
  deal_damage: (params) => amount(params),
  drain: (params) => 1.5 * amount(params),
  heal: (params) => 0.5 * amount(params),
  draw_card: (params) => 2 * amount(params),
  discard: (params) => 1.5 * amount(params),
  mill: (params) => 0.3 * amount(params),
  modify_stats: (params) => 0.7 * (Math.abs(Number(params.attack ?? 0)) + Math.abs(Number(params.health ?? 0))),
  destroy: () => 4,
  return_to_hand: () => 2.5,
  sacrifice: () => -1,
});

/** @param {Readonly<Record<string, number | string>>} params */
function amount(params) {
  return Number(params.amount ?? 0);
}

export class CardValuer {
  /**
   * A creature on the battlefield, by its lasting stats.
   * @param {CardView} card
   */
  creature(card) {
    const temporary = card.modifiers.filter((modifier) => modifier.duration === ModifierDuration.END_OF_TURN);
    const attack = Math.max(0, card.attack - temporary.reduce((sum, modifier) => sum + modifier.attack, 0));
    const health = Math.max(0, card.health - temporary.reduce((sum, modifier) => sum + modifier.health, 0));
    return VALUE.attack * attack + VALUE.health * health + VALUE.body + this.#keywords(card, attack) + this.#lingeringAbilities(card);
  }

  /**
   * A card in its owner's hand.
   * @param {CardView} card
   */
  inHand(card) {
    const cost = card.definitionId === UNKNOWN_CARD_ID ? VALUE.averageCost : card.cost;
    return VALUE.handCard + VALUE.handCardPerCost * cost;
  }

  /** A card in a hand nobody shows. */
  get unknownInHand() {
    return VALUE.handCard + VALUE.handCardPerCost * VALUE.averageCost;
  }

  /**
   * @param {CardView} card
   * @param {number} attack lasting attack
   */
  #keywords(card, attack) {
    const trample = hasKeyword(card, Keyword.TRAMPLE) ? VALUE.trample * attack : 0;
    const vigilance = hasKeyword(card, Keyword.VIGILANCE) ? VALUE.vigilance : 0;
    return trample + vigilance;
  }

  /**
   * Abilities still to fire while the creature is in play: on death once, at turn start every turn.
   * @param {CardView} card
   */
  #lingeringAbilities(card) {
    if (card.type !== CardType.CREATURE) {
      return 0;
    }
    return card.abilities.reduce((sum, ability) => sum + lingeringValue(ability), 0);
  }
}

/** @param {AbilityView} ability */
function lingeringValue(ability) {
  const value = EFFECT_VALUE[ability.effect]?.(ability.params) ?? 0;
  if (ability.trigger === TriggerType.ON_DEATH) {
    return value;
  }
  return ability.trigger === TriggerType.ON_TURN_START ? VALUE.recurring * value : 0;
}
