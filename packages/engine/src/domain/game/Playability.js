/**
 * Whether and how a card in hand can be played. Shared by PlayCardHandler
 * (validation) and LegalMoves (UI highlighting, AI), so the two can never
 * disagree.
 *
 * Targeting rule: a play ability with no legal target simply does not happen
 * and the card is played anyway — a Banishing Mage against an empty board is
 * a 3/3 body. Two exceptions make the card unplayable instead: a spell (it
 * would do nothing at all) and an ability the card declares `mandatory`,
 * which it pays rather than gains (Bone Colossus' tribute). A card never
 * targets itself with its own play ability, so a lone creature cannot
 * satisfy its own ally-targeted ability.
 */
import { CommandError } from "../commands/CommandError.js";
import { candidatesFor, validateChosenTargets } from "../effects/TargetResolver.js";
import { playTriggerFor } from "../effects/TriggerDispatcher.js";

/**
 * @typedef {Readonly<{ code: string, message: string }>} PlayabilityProblem
 */

/**
 * Abilities of the card's play trigger whose targets the player must choose.
 * @param {import("../cards/CardDefinition.js").CardDefinition} definition
 */
export function playerTargetedPlayAbilities(definition) {
  return definition.abilitiesFor(playTriggerFor(definition)).filter((ability) => ability.target !== null && !ability.target.isAutomatic);
}

/**
 * Legal target ids for each player-targeted play ability, in ability order.
 * A group is empty when that ability has nothing to target; the card is still
 * playable unless `mustBeTargetable` says otherwise.
 * @param {import("./GameState.js").GameState} state
 * @param {import("../cards/CardInstance.js").CardInstance} card
 * @returns {readonly (readonly string[])[]}
 */
export function targetOptionsFor(state, card) {
  return Object.freeze(
    playerTargetedPlayAbilities(card.definition).map((ability) =>
      Object.freeze(candidatesFor(state, ability.target, { controllerId: card.controllerId, excludeId: card.instanceId })),
    ),
  );
}

/**
 * Whether the card is held back when this play ability has no legal target,
 * rather than entering play with the ability fizzling.
 * @param {import("../cards/CardInstance.js").CardInstance} card
 * @param {import("../cards/Ability.js").Ability} ability
 */
function mustBeTargetable(card, ability) {
  return card.definition.isSpell || ability.mandatory;
}

/**
 * Checks cost, zone capacity and target availability. Does not check whose turn it is.
 * @param {import("./GameState.js").GameState} state
 * @param {import("./Player.js").Player} player
 * @param {import("../cards/CardInstance.js").CardInstance} card
 * @param {import("./GameRules.js").GameRules} rules
 * @returns {PlayabilityProblem | null}
 */
export function playabilityProblem(state, player, card, rules) {
  if (!player.resources.canAfford(card.definition.cost)) {
    return problem(CommandError.CANNOT_AFFORD, `${card.definition.name} costs ${card.definition.cost}; ${player.resources.current} available`);
  }
  if (card.isCreature && player.creatures.length >= rules.maxBattlefieldCreatures) {
    return problem(CommandError.ZONE_FULL, `the battlefield already holds ${rules.maxBattlefieldCreatures} creatures`);
  }
  const options = targetOptionsFor(state, card);
  const unsatisfied = playerTargetedPlayAbilities(card.definition).findIndex((ability, index) => options[index].length === 0 && mustBeTargetable(card, ability));
  if (unsatisfied !== -1) {
    return problem(CommandError.INVALID_TARGET, `${card.definition.name} has no legal target`);
  }
  return null;
}

/**
 * Splits the flat `targets` array of a PLAY_CARD command across the card's
 * player-targeted abilities and validates each group. An ability with no
 * legal target takes no ids: it fizzles, and the caller passes none for it.
 * @param {import("./GameState.js").GameState} state
 * @param {import("../cards/CardInstance.js").CardInstance} card
 * @param {readonly string[]} targetIds
 * @returns {{ groups: readonly (readonly string[])[] } | PlayabilityProblem}
 */
export function splitChosenTargets(state, card, targetIds) {
  const abilities = playerTargetedPlayAbilities(card.definition);
  const options = targetOptionsFor(state, card);
  const groups = [];
  let cursor = 0;
  for (const [index, ability] of abilities.entries()) {
    const expected = options[index].length === 0 ? 0 : ability.target.count;
    const group = targetIds.slice(cursor, cursor + expected);
    cursor += expected;
    const scope = { controllerId: card.controllerId, excludeId: card.instanceId };
    const failure = expected === 0 ? null : validateChosenTargets(state, ability.target, group, scope);
    if (failure !== null) {
      return problem(CommandError.INVALID_TARGET, failure);
    }
    groups.push(Object.freeze(group));
  }
  if (cursor !== targetIds.length) {
    return problem(CommandError.INVALID_TARGET, `expected ${cursor} target(s), got ${targetIds.length}`);
  }
  return { groups: Object.freeze(groups) };
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {PlayabilityProblem}
 */
function problem(code, message) {
  return Object.freeze({ code, message });
}
