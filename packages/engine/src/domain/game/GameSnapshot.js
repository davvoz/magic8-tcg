/**
 * Read-only projection of GameState for everything outside the domain.
 *
 * - Plain data, deep-frozen: the renderer, input layer and AI cannot mutate
 *   the game through it, by construction.
 * - Perspective-filtered: a player's snapshot shows the opponent's hand and
 *   both libraries as counts only. `SPECTATOR` sees what the table shows (no
 *   hand, no legal moves); `perspectivePlayerId === null` yields an
 *   omniscient view (tests, debugging, replay).
 * - Self-describing cards: printed values are copied in so presentation does
 *   not need the catalog to draw the board.
 */
import { deepFreeze } from "../../shared/deepFreeze.js";
import { GameEventType } from "./GameEventType.js";
import { computeLegalMoves } from "./LegalMoves.js";

/**
 * The perspective of someone watching a game they do not play: every hand is
 * hidden. Never a valid player id (ids match LIMITS.ID_PATTERN).
 */
export const SPECTATOR = "#spectator";

/**
 * @typedef {Readonly<{
 *   instanceId: string, definitionId: string, name: string, type: string, faction: string,
 *   cost: number, attack: number, health: number, maxHealth: number, damage: number,
 *   keywords: readonly string[], text: string, ownerId: string, controllerId: string,
 *   summoningSick: boolean, exhausted: boolean, zone: string,
 *   abilities: readonly AbilityView[], modifiers: readonly ModifierView[],
 *   printedAttack: number, printedHealth: number, printedCost: number
 * }>} CardView
 *
 * `attack`, `health` and `maxHealth` are the card's current values;
 * `printedAttack` and `printedHealth` what the card says. `cost` is what the
 * card costs its owner now (a match condition may change it), `printedCost`
 * what it says. `keywords` include those a condition gave it. `modifiers`: the
 * stat changes on the card, public like everything on the table; the
 * current values already include them (and `damage`).
 * @typedef {Readonly<{ attack: number, health: number, duration: string }>} ModifierView
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
 * @param {number} [cost] what it costs now (default: what it says)
 * @returns {CardView}
 */
export function projectCard(card, cost = card.definition.cost) {
  const { definition } = card;
  return {
    instanceId: card.instanceId,
    definitionId: definition.id,
    name: definition.name,
    type: definition.type,
    faction: definition.faction,
    cost,
    attack: card.attack,
    health: card.health,
    maxHealth: card.maxHealth,
    damage: card.damage,
    keywords: [...card.keywords],
    text: definition.text,
    ownerId: card.ownerId,
    controllerId: card.controllerId,
    summoningSick: card.summoningSick,
    exhausted: card.exhausted,
    zone: card.zone,
    abilities: definition.abilities.map(projectAbility),
    modifiers: card.modifiers.map((modifier) => ({ ...modifier })),
    printedAttack: definition.attack,
    printedHealth: definition.health,
    printedCost: definition.cost,
  };
}

/**
 * @param {import("./Player.js").Player} player
 * @param {boolean} revealHand
 * @param {import("../conditions/MatchConditions.js").MatchConditions} conditions
 */
function projectPlayer(player, revealHand, conditions) {
  return {
    id: player.id,
    name: player.name,
    life: player.life,
    maxLife: player.maxLife,
    resources: { current: player.resources.current, max: player.resources.max },
    librarySize: player.library.size,
    handSize: player.hand.size,
    hand: revealHand ? player.hand.cards.map((card) => projectCard(card, conditions.costOf(player.id, card.definition))) : null,
    battlefield: player.battlefield.cards.map((card) => projectCard(card)),
    graveyard: player.graveyard.cards.map((card) => projectCard(card)),
  };
}

/**
 * @param {import("./GameState.js").GameState} state
 * @param {string | null} perspectivePlayerId
 * @param {import("./GameRules.js").GameRules} rules
 */
export function createSnapshot(state, perspectivePlayerId, rules) {
  const omniscient = perspectivePlayerId === null;
  const spectator = perspectivePlayerId === SPECTATOR;
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
    players: state.players.map((player) => projectPlayer(player, omniscient || player.id === perspectivePlayerId, state.conditions)),
    combat: state.combat.toPlain(),
    conditions: state.conditions.toPlain(),
    legalMoves: omniscient || spectator ? null : computeLegalMoves(state, perspectivePlayerId, rules),
  });
}

/** Event fields that reveal hidden information to players other than `playerId`. */
const PRIVATE_EVENT_FIELDS = Object.freeze({
  [GameEventType.CARD_DRAWN]: Object.freeze(["definitionId"]),
});

/**
 * Removes hidden information from events before they reach a player (or,
 * with SPECTATOR, anyone watching: every private field goes).
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
