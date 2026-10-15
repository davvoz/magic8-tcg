/**
 * Rebuilds a playable game from what one player sees, so the search AI can
 * try moves on the real engine (same rules, same effects, no copy of them
 * to drift) without ever knowing more than a human in its seat.
 *
 * Everything on the table comes back exactly: life, resources, creatures
 * with their damage, buffs, granted keywords and readiness, graveyards, the
 * combat in course, and the game's conditions (docs/tcg/24-sfide.md).
 * What the player cannot see becomes an "unknown" card: the opponent's hand
 * and both libraries, in their true sizes. An unknown card costs more than
 * anyone can pay, so it is never played; it can still be drawn, milled or
 * discarded, so draws, fatigue and hand limits happen as in the real game.
 *
 * The rebuilt game has its own fixed random generator: random effects
 * (a random discard) pick among unknown cards anyway, and a fixed generator
 * keeps the AI deterministic.
 */
import { CardDefinition } from "../../cards/CardDefinition.js";
import { CardInstance } from "../../cards/CardInstance.js";
import { CardType } from "../../cards/CardType.js";
import { createCoreCommandRegistry } from "../../commands/registerCoreCommands.js";
import { CombatState } from "../../combat/CombatState.js";
import { MatchConditions } from "../../conditions/MatchConditions.js";
import { GameEngine } from "../../game/GameEngine.js";
import { GameState } from "../../game/GameState.js";
import { Player } from "../../game/Player.js";
import { ZoneType } from "../../game/ZoneType.js";
import { ChaChaRandom } from "../../random/ChaChaRandom.js";
import { ResourcePool } from "../../resources/ResourcePool.js";
import { UNKNOWN_CARD_ID } from "../cardViews.js";

/** Seed of every rebuilt game's random generator. */
const WORLD_SEED = 1;

/** A card nobody can pay for, with no effect: stands in for every hidden card. */
const UNKNOWN_CARD = new CardDefinition({
  id: UNKNOWN_CARD_ID,
  name: "Unknown card",
  type: CardType.SPELL,
  faction: "neutral",
  cost: Number.MAX_SAFE_INTEGER,
  attack: 0,
  health: 0,
  keywords: [],
  abilities: [],
  text: "",
});

/** @typedef {import("../AiPolicy.contract.js").Snapshot} Snapshot */
/** @typedef {Snapshot["players"][number]} PlayerView */
/** @typedef {import("../../game/GameSnapshot.js").CardView} CardView */

export class PerspectiveWorld {
  #rules;
  #catalog;
  #effects;
  #commands;

  /**
   * @param {{ rules: import("../../game/GameRules.js").GameRules, catalog: import("../../cards/CardCatalog.js").CardCatalog, effects: import("../../effects/EffectRegistry.js").EffectRegistry, commands?: import("../../commands/CommandRegistry.js").CommandRegistry }} deps
   *   the content and registries of the game being played
   */
  constructor({ rules, catalog, effects, commands = createCoreCommandRegistry() }) {
    this.#rules = rules;
    this.#catalog = catalog;
    this.#effects = effects;
    this.#commands = commands;
  }

  /**
   * @param {Snapshot} snapshot a player's perspective (its own hand revealed)
   * @returns {GameEngine} started, at the snapshot's decision point
   */
  build(snapshot) {
    const unknownIds = new UnknownIds();
    const players = snapshot.players.map((view) => this.#player(view, unknownIds));
    const conditions = MatchConditions.fromPlain(snapshot.conditions, snapshot.players.map((view) => view.id));
    if (!conditions.ok) {
      throw new RangeError(`PerspectiveWorld: the snapshot's conditions do not read back (${conditions.error.message})`);
    }
    const state = new GameState({
      players,
      turnNumber: snapshot.turnNumber,
      activePlayerId: snapshot.activePlayerId,
      awaitingPlayerId: snapshot.awaitingPlayerId,
      phase: snapshot.phase,
      combat: combatOf(snapshot.combat),
      rng: ChaChaRandom.fromSeed(WORLD_SEED),
      winnerId: snapshot.winnerId,
      endReason: snapshot.endReason,
      ended: snapshot.isOver,
      version: snapshot.version,
      conditions: conditions.value,
    });
    return GameEngine.resume({ state, rules: this.#rules, catalog: this.#catalog, effects: this.#effects, commands: this.#commands });
  }

  /**
   * @param {PlayerView} view
   * @param {UnknownIds} unknownIds
   */
  #player(view, unknownIds) {
    const player = new Player({ id: view.id, name: view.name, life: view.life, maxLife: view.maxLife, resources: new ResourcePool({ current: view.resources.current, max: view.resources.max }) });
    const hand = view.hand ?? [];
    for (const card of hand) {
      player.hand.add(this.#instance(card, ZoneType.HAND));
    }
    for (let count = hand.length; count < view.handSize; count += 1) {
      player.hand.add(unknownCard(unknownIds.next(), view.id, ZoneType.HAND));
    }
    for (const card of view.battlefield) {
      player.battlefield.add(this.#instance(card, ZoneType.BATTLEFIELD));
    }
    for (const card of view.graveyard) {
      player.graveyard.add(this.#instance(card, ZoneType.GRAVEYARD));
    }
    for (let count = 0; count < view.librarySize; count += 1) {
      player.library.add(unknownCard(unknownIds.next(), view.id, ZoneType.LIBRARY));
    }
    return player;
  }

  /**
   * @param {CardView} view
   * @param {string} zone
   */
  #instance(view, zone) {
    const definition = this.#catalog.get(view.definitionId);
    if (definition === undefined) {
      throw new RangeError(`PerspectiveWorld: card "${view.definitionId}" is not in the catalog; the AI was given other content than the game`);
    }
    const card = new CardInstance({ instanceId: view.instanceId, definition, ownerId: view.ownerId, controllerId: view.controllerId, zone });
    for (const modifier of view.modifiers) {
      card.addModifier(modifier);
    }
    for (const keyword of view.keywords) {
      card.grantKeyword(keyword);
    }
    card.damage = view.damage;
    card.summoningSick = view.summoningSick;
    card.exhausted = view.exhausted;
    return card;
  }
}

/** Ids for unknown cards, unique within one rebuilt game and unlike any real instance id ("c" + number). */
class UnknownIds {
  #next = 1;

  next() {
    const id = `u${this.#next}`;
    this.#next += 1;
    return id;
  }
}

/**
 * @param {string} instanceId
 * @param {string} ownerId
 * @param {string} zone
 */
function unknownCard(instanceId, ownerId, zone) {
  return new CardInstance({ instanceId, definition: UNKNOWN_CARD, ownerId, zone });
}

/** @param {Snapshot["combat"]} plain */
function combatOf(plain) {
  return new CombatState({ attackerIds: plain.attackerIds, blocks: new Map(plain.blocks.map((block) => [block.attackerId, block.blockerIds])) });
}
