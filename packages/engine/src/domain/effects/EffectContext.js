/**
 * What an effect handler sees while resolving: the pending effect, the
 * materialised targets, the controlling player, and narrowly scoped ways to
 * change the world (damage, healing, drawing, zone moves, emitting events). Handlers do
 * not receive the ExecutionContext directly, which keeps their surface small
 * and reviewable.
 */
import { GameEventType } from "../game/GameEventType.js";
import { ZoneType } from "../game/ZoneType.js";
import { materialiseTargets } from "./TargetResolver.js";

export class EffectContext {
  /** @type {import("./PendingEffect.js").PendingEffect} */
  pending;
  /** @type {import("../game/GameState.js").GameState} */
  state;
  /** @type {import("../game/Player.js").Player} */
  controller;
  /** @type {readonly import("../cards/CardInstance.js").CardInstance[]} */
  targetCreatures;
  /** @type {readonly import("../game/Player.js").Player[]} */
  targetPlayers;
  #execution;

  /**
   * @param {import("./PendingEffect.js").PendingEffect} pending
   * @param {import("../game/GameState.js").GameState} state
   * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} execution
   */
  constructor(pending, state, execution) {
    this.pending = pending;
    this.state = state;
    this.controller = state.requirePlayer(pending.controllerId);
    const { creatures, players } = materialiseTargets(state, pending.targetIds);
    this.targetCreatures = Object.freeze(creatures);
    this.targetPlayers = Object.freeze(players);
    this.#execution = execution;
    Object.freeze(this);
  }

  get params() {
    return this.pending.params;
  }

  get rules() {
    return this.#execution.rules;
  }

  /**
   * @param {string} type
   * @param {Record<string, unknown>} [data]
   */
  emit(type, data = {}) {
    this.#execution.events.emit(type, { sourceId: this.pending.sourceId, ...data });
  }

  /**
   * @param {import("../cards/CardInstance.js").CardInstance} creature
   * @param {number} amount
   * @returns {number} damage actually applied
   */
  damageCreature(creature, amount) {
    const applied = creature.takeDamage(amount);
    this.emit(GameEventType.DAMAGE_DEALT, { targetId: creature.instanceId, amount: applied, remainingHealth: creature.health });
    return applied;
  }

  /**
   * @param {import("../game/Player.js").Player} player
   * @param {number} amount
   * @returns {number} life actually lost
   */
  damagePlayer(player, amount) {
    const lost = player.loseLife(amount);
    this.emit(GameEventType.DAMAGE_DEALT, { targetId: player.id, amount: lost });
    this.emit(GameEventType.LIFE_CHANGED, { playerId: player.id, life: player.life, delta: -lost });
    return lost;
  }

  /**
   * Marks a creature for the graveyard: it takes damage equal to its
   * remaining health, so state-based actions bury it and its death
   * triggers fire through the ordinary pipeline. No-op off the battlefield.
   * @param {import("../cards/CardInstance.js").CardInstance} creature
   */
  sacrificeCreature(creature) {
    this.#markLethal(creature, GameEventType.CREATURE_SACRIFICED);
  }

  /**
   * Destroys a creature: the same pipeline as a sacrifice (lethal damage,
   * then state-based actions and death triggers), announced as a destruction.
   * @param {import("../cards/CardInstance.js").CardInstance} creature
   */
  destroyCreature(creature) {
    this.#markLethal(creature, GameEventType.CREATURE_DESTROYED);
  }

  /**
   * Moves a creature from the battlefield back to its owner's hand. Leaving
   * the battlefield clears damage, modifiers and combat flags
   * (CardInstance.moveTo); the hand limit applies at end of turn as it does
   * for drawn cards. No-op off the battlefield.
   * @param {import("../cards/CardInstance.js").CardInstance} creature
   */
  returnToHand(creature) {
    if (creature.zone !== ZoneType.BATTLEFIELD) {
      return;
    }
    const controller = this.state.requirePlayer(creature.controllerId);
    const owner = this.state.requirePlayer(creature.ownerId);
    controller.battlefield.remove(creature.instanceId);
    creature.revertControl();
    owner.hand.add(creature);
    this.emit(GameEventType.CARD_RETURNED, { targetId: creature.instanceId, definitionId: creature.definitionId, playerId: owner.id });
  }

  /**
   * Moves up to `amount` cards from the top of the player's library to their
   * graveyard. An empty library simply stops the mill: fatigue is inflicted
   * by draws only.
   * @param {import("../game/Player.js").Player} player
   * @param {number} amount
   * @returns {number} cards actually milled
   */
  millCards(player, amount) {
    let milled = 0;
    while (milled < amount) {
      const card = player.library.takeTop();
      if (card === undefined) {
        break;
      }
      player.graveyard.add(card);
      this.emit(GameEventType.CARD_MILLED, { playerId: player.id, instanceId: card.instanceId, definitionId: card.definitionId });
      milled += 1;
    }
    return milled;
  }

  /**
   * Discards up to `amount` cards chosen at random (seeded) from the player's hand.
   * @param {import("../game/Player.js").Player} player
   * @param {number} amount
   * @returns {number} cards actually discarded
   */
  discardRandom(player, amount) {
    let discarded = 0;
    while (discarded < amount && !player.hand.isEmpty) {
      const cards = player.hand.cards;
      const card = cards[this.state.rng.nextInt(cards.length)];
      player.hand.remove(card.instanceId);
      player.graveyard.add(card);
      this.emit(GameEventType.CARD_DISCARDED, { playerId: player.id, instanceId: card.instanceId, definitionId: card.definitionId });
      discarded += 1;
    }
    return discarded;
  }

  /**
   * @param {import("../cards/CardInstance.js").CardInstance} creature
   * @param {number} amount
   */
  healCreature(creature, amount) {
    const healed = creature.heal(amount);
    this.emit(GameEventType.HEALED, { targetId: creature.instanceId, amount: healed });
  }

  /**
   * @param {import("../game/Player.js").Player} player
   * @param {number} amount
   */
  healPlayer(player, amount) {
    const gained = player.gainLife(amount, this.rules.startingLife);
    this.emit(GameEventType.HEALED, { targetId: player.id, amount: gained });
    this.emit(GameEventType.LIFE_CHANGED, { playerId: player.id, life: player.life, delta: gained });
  }

  /**
   * @param {import("../game/Player.js").Player} player
   * @param {number} amount
   */
  drawCards(player, amount) {
    this.#execution.turnManager.drawCards(this.state, player, amount, this.#execution);
  }

  /**
   * Gives a creature damage equal to its remaining health so state-based
   * actions bury it; `eventType` says why. No-op off the battlefield.
   * @param {import("../cards/CardInstance.js").CardInstance} creature
   * @param {string} eventType
   */
  #markLethal(creature, eventType) {
    if (creature.zone !== ZoneType.BATTLEFIELD || creature.health <= 0) {
      return;
    }
    creature.takeDamage(creature.health);
    this.emit(eventType, { targetId: creature.instanceId, playerId: creature.controllerId });
  }
}
