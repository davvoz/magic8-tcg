/**
 * Questions the AI asks of the cards in a snapshot (CardView), answered
 * from the view alone: the AI never sees engine entities.
 */
import { CardType } from "../cards/CardType.js";
import { TargetKind, TargetOwner } from "../effects/TargetSpec.js";
import { TriggerType } from "../effects/TriggerType.js";

/**
 * Definition id of a card the AI cannot see (the opponent's hand, the
 * libraries) in a game it rebuilt to search (search/PerspectiveWorld.js).
 */
export const UNKNOWN_CARD_ID = "unknown";

/** @typedef {import("../game/GameSnapshot.js").CardView} CardView */
/** @typedef {import("../game/GameSnapshot.js").AbilityView} AbilityView */

/**
 * Mirrors TargetSpec.isAutomatic: the engine resolves these targets itself.
 * @param {NonNullable<AbilityView["target"]>} target
 */
export function isAutomaticTarget(target) {
  return target.kind === TargetKind.PLAYER && target.owner !== TargetOwner.ANY && target.count === 1;
}

/**
 * The card's play-trigger abilities, in the order the engine fires them.
 * @param {CardView} card
 * @returns {readonly AbilityView[]}
 */
export function playAbilities(card) {
  const trigger = card.type === CardType.CREATURE ? TriggerType.ON_PLAY : TriggerType.ON_CAST;
  return card.abilities.filter((ability) => ability.trigger === trigger);
}

/**
 * The abilities whose targets travel in the PLAY_CARD command, in the order
 * `legalMoves.targetOptions` lists them (mirrors Playability).
 * @param {CardView} card
 * @returns {readonly AbilityView[]}
 */
export function playerTargetedAbilities(card) {
  return playAbilities(card).filter((ability) => ability.target !== null && !isAutomaticTarget(ability.target));
}

/**
 * @param {CardView} card
 * @param {string} keyword one of Keyword
 */
export function hasKeyword(card, keyword) {
  return card.keywords.includes(keyword);
}
