/**
 * The moves the search AI considers at one of its decision points, from its
 * own snapshot and the engine's legal moves:
 *
 * - main phase: every playable card with every distinct choice of targets,
 *   and moving on (to combat from the first main phase, ending the turn
 *   from the second);
 * - declare attackers: combinations of attackers, all of them when there
 *   are few enough for the budget, otherwise the telling ones (none, all,
 *   each alone, all but each, the strongest and the weakest few).
 *
 * Choices that cannot differ are generated once: two copies of a card in
 * hand, two identical creatures as targets. Blocks are not generated here
 * (BlockPlanner improves them step by step instead).
 */
import { declareAttackers, endPhase, endTurn, playCard } from "../../commands/commandFactories.js";
import { GamePhase } from "../../game/GamePhase.js";
import { playerTargetedAbilities } from "../cardViews.js";

/** @typedef {import("../AiPolicy.contract.js").Snapshot} Snapshot */
/** @typedef {import("../../game/GameSnapshot.js").CardView} CardView */
/** @typedef {Readonly<Record<string, unknown>>} Command */

/** Target choices tried per card: a safety bound, cards have far fewer. */
const MAX_TARGET_CHOICES = 32;

export class ActionGenerator {
  #attackSubsets;

  /** @param {{ attackSubsets: number }} settings the most combinations of attackers to try */
  constructor({ attackSubsets }) {
    this.#attackSubsets = Math.max(1, attackSubsets);
  }

  /**
   * @param {Snapshot} snapshot the AI's own, at its decision
   * @returns {Command[]}
   */
  actionsFor(snapshot) {
    const me = /** @type {string} */ (snapshot.perspectivePlayerId);
    switch (snapshot.phase) {
      case GamePhase.MAIN_1:
        return [...this.#plays(snapshot), endPhase(me)];
      case GamePhase.MAIN_2:
        return [...this.#plays(snapshot), endTurn(me)];
      case GamePhase.COMBAT_ATTACKERS:
        return this.#attackSets(snapshot).map((attackers) => declareAttackers(me, attackers));
      default:
        return [];
    }
  }

  /** @param {Snapshot} snapshot */
  #plays(snapshot) {
    const me = /** @type {string} */ (snapshot.perspectivePlayerId);
    const legal = /** @type {NonNullable<Snapshot["legalMoves"]>} */ (snapshot.legalMoves);
    const hand = snapshot.players.find((player) => player.id === me)?.hand ?? [];
    const seen = new Set();
    const plays = [];
    for (const card of hand) {
      if (!legal.playableCardIds.includes(card.instanceId) || seen.has(card.definitionId)) {
        continue;
      }
      seen.add(card.definitionId);
      const choices = targetChoices(card, legal.targetOptions[card.instanceId] ?? [], snapshot);
      plays.push(...choices.map((targets) => playCard(me, card.instanceId, targets)));
    }
    return plays;
  }

  /** @param {Snapshot} snapshot */
  #attackSets(snapshot) {
    const ids = /** @type {NonNullable<Snapshot["legalMoves"]>} */ (snapshot.legalMoves).attackerIds;
    if (2 ** ids.length <= this.#attackSubsets) {
      return allSubsets(ids);
    }
    const me = snapshot.players.find((player) => player.id === snapshot.perspectivePlayerId);
    const attackOf = new Map((me?.battlefield ?? []).map((card) => [card.instanceId, card.attack]));
    return telltaleSubsets(ids, (id) => attackOf.get(id) ?? 0).slice(0, this.#attackSubsets);
  }
}

/**
 * Every distinct way to choose the card's targets: one group per targeted
 * ability (in order), each a set of `count` distinct options.
 * @param {CardView} card
 * @param {readonly (readonly string[])[]} options per targeted ability
 * @param {Snapshot} snapshot
 * @returns {string[][]}
 */
function targetChoices(card, options, snapshot) {
  const identity = targetIdentity(snapshot);
  /** @type {string[][]} */
  let choices = [[]];
  playerTargetedAbilities(card).forEach((ability, index) => {
    const distinct = distinctBy(options[index] ?? [], identity);
    const groups = distinct.length === 0 ? [[]] : combinations(distinct, ability.target?.count ?? 1);
    choices = choices.flatMap((chosen) => groups.map((group) => [...chosen, ...group])).slice(0, MAX_TARGET_CHOICES);
  });
  return choices;
}

/**
 * What a target is, for telling apart choices that could make a difference:
 * a player is themself; a creature is its card, stats and controller.
 * @param {Snapshot} snapshot
 * @returns {(id: string) => string}
 */
function targetIdentity(snapshot) {
  const creatures = new Map(snapshot.players.flatMap((player) => player.battlefield.map((card) => [card.instanceId, card])));
  return (id) => {
    const card = creatures.get(id);
    return card === undefined ? id : `${card.controllerId}:${card.definitionId}:${card.attack}/${card.health}/${card.maxHealth}:${Number(card.exhausted)}${Number(card.summoningSick)}`;
  };
}

/**
 * @param {readonly string[]} ids
 * @param {(id: string) => string} identity
 */
function distinctBy(ids, identity) {
  const seen = new Set();
  return ids.filter((id) => {
    const key = identity(id);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * @param {readonly string[]} items
 * @param {number} size
 * @returns {string[][]}
 */
function combinations(items, size) {
  if (size <= 0) {
    return [[]];
  }
  if (items.length <= size) {
    return [[...items]];
  }
  const [first, ...rest] = items;
  return [...combinations(rest, size - 1).map((group) => [first, ...group]), ...combinations(rest, size)];
}

/**
 * @param {readonly string[]} ids
 * @returns {string[][]} smallest first
 */
function allSubsets(ids) {
  const subsets = [];
  for (let mask = 0; mask < 2 ** ids.length; mask += 1) {
    subsets.push(ids.filter((_, index) => (mask >> index) & 1));
  }
  return subsets.sort((a, b) => a.length - b.length);
}

/**
 * The combinations worth trying when there are too many for all of them, the likeliest first.
 * @param {readonly string[]} ids
 * @param {(id: string) => number} attackOf
 * @returns {string[][]}
 */
function telltaleSubsets(ids, attackOf) {
  const strongestFirst = [...ids].sort((a, b) => attackOf(b) - attackOf(a));
  const candidates = [
    [],
    [...ids],
    ...strongestFirst.map((_, size) => strongestFirst.slice(0, size + 1)),
    ...strongestFirst.map((_, size) => strongestFirst.slice(size + 1)),
    ...ids.map((id) => [id]),
    ...ids.map((id) => ids.filter((other) => other !== id)),
  ];
  const seen = new Set();
  return candidates.filter((subset) => {
    const key = [...subset].sort().join(",");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
