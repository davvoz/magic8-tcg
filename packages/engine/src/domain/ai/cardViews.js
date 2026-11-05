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

const DRAW_CARD = "draw_card";
const HEAL = "heal";
/** What a spell does beside drawing that is not worth casting it for alone (a heal only up to its draws). */
const DRAW_RIDERS = Object.freeze([DRAW_CARD, "mill", HEAL, "sacrifice"]);

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
 * Cards the card draws when played.
 * @param {CardView} card
 */
export function playDraws(card) {
  return playAbilities(card)
    .filter((ability) => ability.effect === DRAW_CARD)
    .reduce((sum, ability) => sum + Number(ability.params?.amount ?? 0), 0);
}

/**
 * A spell cast for its cards when there is none left to draw: every draw
 * from an empty library costs life (fatigue) or the game, and nothing else
 * it does (milling, a heal no bigger than the draws, its sacrifice) is
 * worth that.
 * @param {CardView} card
 * @param {number} librarySize its caster's
 */
export function drawsIntoEmptyLibrary(card, librarySize) {
  const draws = playDraws(card);
  const abilities = playAbilities(card);
  const heals = abilities.filter((ability) => ability.effect === HEAL).reduce((sum, ability) => sum + Number(ability.params?.amount ?? 0), 0);
  return card.type === CardType.SPELL && librarySize === 0 && draws > 0 && heals <= draws && abilities.every((ability) => DRAW_RIDERS.includes(ability.effect));
}

/**
 * @param {CardView} card
 * @param {string} keyword one of Keyword
 */
export function hasKeyword(card, keyword) {
  return card.keywords.includes(keyword);
}
