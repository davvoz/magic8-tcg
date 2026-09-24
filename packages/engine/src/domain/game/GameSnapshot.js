/**
 * Read-only projection of GameState for everything outside the domain.
 *
 * - Plain data, deep-frozen: the renderer, input layer and AI cannot mutate
 *   the game through it, by construction.
 * - Perspective-filtered: a player's snapshot shows the opponent's hand and
 *   both libraries as counts only. `perspectivePlayerId === null` yields an
 *   omniscient view (tests, debugging, future spectator mode).
 * - Self-describing cards: printed values are copied in so presentation does
 *   not need the catalog to draw the board.
 */
import { deepFreeze } from "../../shared/deepFreeze.js";
import { GameEventType } from "./GameEventType.js";
import { computeLegalMoves } from "./LegalMoves.js";

/**
 * @typedef {Readonly<{
 *   instanceId: string, definitionId: string, name: string, type: string, faction: string,
 *   cost: number, attack: number, health: number, maxHealth: number, damage: number,
 *   keywords: readonly string[], text: string, ownerId: string, controllerId: string,
 *   summoningSick: boolean, exhausted: boolean, zone: string,
 *   abilities: readonly AbilityView[]
 * }>} CardView
 *
 * @typedef {Readonly<{
 *   trigger: string, effect: string, params: Readonly<Record<string, number | string>>,
 *   target: Readonly<{ kind: string, owner: string, count: number }> | null
 * }>} AbilityView
 */

/**
 * @param {import("../cards/Ability.js").Ability} ability
 * @returns {AbilityView}
 */
function projectAbility(ability) {
  return {
    trigger: ability.trigger,
    effect: ability.effect,
    params: { ...ability.params },
    target: ability.target === null ? null : { kind: ability.target.kind, owner: ability.target.owner, count: ability.target.count },
  };
}

/**
 * @param {import("../cards/CardInstance.js").CardInstance} card
 * @returns {CardView}
 */
export function projectCard(card) {
  const { definition } = card;
  return {
    instanceId: card.instanceId,
    definitionId: definition.id,
    name: definition.name,
    type: definition.type,
    faction: definition.faction,
    cost: definition.cost,
    attack: card.attack,
    health: card.health,
    maxHealth: card.maxHealth,
    damage: card.damage,
    keywords: [...definition.keywords],
    text: definition.text,
    ownerId: card.ownerId,
    controllerId: card.controllerId,
    summoningSick: card.summoningSick,
    exhausted: card.exhausted,
    zone: card.zone,
    abilities: definition.abilities.map(projectAbility),
  };
}

/**
 * @param {import("./Player.js").Player} player
 * @param {boolean} revealHand
 * @param {import("./GameRules.js").GameRules} rules
 */
function projectPlayer(player, revealHand, rules) {
  return {
    id: player.id,
    name: player.name,
    life: player.life,
    maxLife: rules.startingLife,
    resources: { current: player.resources.current, max: player.resources.max },
    librarySize: player.library.size,
    handSize: player.hand.size,
    hand: revealHand ? player.hand.cards.map(projectCard) : null,
    battlefield: player.battlefield.cards.map(projectCard),
    graveyard: player.graveyard.cards.map(projectCard),
  };
}

/**
 * @param {import("./GameState.js").GameState} state
 * @param {string | null} perspectivePlayerId
 * @param {import("./GameRules.js").GameRules} rules
 */
export function createSnapshot(state, perspectivePlayerId, rules) {
  const omniscient = perspectivePlayerId === null;
  return deepFreeze({
    version: state.version,
    perspectivePlayerId,
    turnNumber: state.turnNumber,
    phase: state.phase,
    activePlayerId: state.activePlayerId,
    awaitingPlayerId: state.awaitingPlayerId,
    isOver: state.isOver,
    winnerId: state.winnerId,
    endReason: state.endReason,
    players: state.players.map((player) => projectPlayer(player, omniscient || player.id === perspectivePlayerId, rules)),
    combat: state.combat.toPlain(),
    legalMoves: omniscient ? null : computeLegalMoves(state, perspectivePlayerId, rules),
  });
}

/** Event fields that reveal hidden information to players other than `playerId`. */
const PRIVATE_EVENT_FIELDS = Object.freeze({
  [GameEventType.CARD_DRAWN]: Object.freeze(["definitionId"]),
});

/**
 * Removes hidden information from events before they reach a player.
 * @param {readonly Readonly<Record<string, unknown>>[]} events
 * @param {string | null} perspectivePlayerId
 */
export function redactEventsFor(events, perspectivePlayerId) {
  if (perspectivePlayerId === null) {
    return events;
  }
  return Object.freeze(
    events.map((event) => {
      const hidden = PRIVATE_EVENT_FIELDS[/** @type {string} */ (event.type)];
      if (hidden === undefined || event.playerId === perspectivePlayerId) {
        return event;
      }
      const copy = { ...event };
      for (const field of hidden) {
        delete copy[field];
      }
      return Object.freeze(copy);
    }),
  );
}
