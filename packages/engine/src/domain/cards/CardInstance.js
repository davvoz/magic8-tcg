/**
 * A card in play: one instance per physical copy. Holds only runtime state;
 * printed values come from the shared CardDefinition. Stat getters are the
 * single entry point for "current" values so that future static effects can
 * be layered in without touching callers.
 *
 * Mutation methods are used exclusively by domain systems inside
 * GameEngine.execute; instances never leave the domain (see GameSnapshot).
 */
import { ZoneType } from "../game/ZoneType.js";

export const ModifierDuration = Object.freeze({
  PERMANENT: "permanent",
  END_OF_TURN: "end_of_turn",
});

/** Hard cap on modifiers per creature; protects against unbounded growth from repeated buffs. */
const MAX_MODIFIERS = 64;

export class CardInstance {
  /** @type {string} */
  instanceId;
  /** @type {import("./CardDefinition.js").CardDefinition} */
  definition;
  /** @type {string} */
  ownerId;
  /** @type {string} */
  controllerId;
  /** @type {string} */
  zone;
  /** @type {number} */
  damage = 0;
  /** @type {boolean} */
  summoningSick = false;
  /** @type {boolean} */
  exhausted = false;
  /** @type {{ attack: number, health: number, duration: string }[]} */
  #modifiers = [];

  /**
   * @param {{ instanceId: string, definition: import("./CardDefinition.js").CardDefinition, ownerId: string, controllerId?: string, zone: string }} fields
   */
  constructor({ instanceId, definition, ownerId, controllerId = ownerId, zone }) {
    this.instanceId = instanceId;
    this.definition = definition;
    this.ownerId = ownerId;
    this.controllerId = controllerId;
    this.zone = zone;
  }

  get definitionId() {
    return this.definition.id;
  }

  get isCreature() {
    return this.definition.isCreature;
  }

  get attack() {
    return Math.max(0, this.definition.attack + this.#sum("attack"));
  }

  get maxHealth() {
    return this.definition.health + this.#sum("health");
  }

  get health() {
    return this.maxHealth - this.damage;
  }

  get isLethallyDamaged() {
    return this.isCreature && this.zone === ZoneType.BATTLEFIELD && this.health <= 0;
  }

  /** @returns {readonly Readonly<{ attack: number, health: number, duration: string }>[]} */
  get modifiers() {
    return Object.freeze(this.#modifiers.map((modifier) => Object.freeze({ ...modifier })));
  }

  /** @param {{ attack: number, health: number, duration: string }} modifier */
  addModifier(modifier) {
    if (this.#modifiers.length >= MAX_MODIFIERS) {
      throw new RangeError(`CardInstance ${this.instanceId}: too many modifiers`);
    }
    this.#modifiers.push({ attack: modifier.attack, health: modifier.health, duration: modifier.duration });
  }

  /** @returns {boolean} whether any modifier expired */
  expireEndOfTurnModifiers() {
    const before = this.#modifiers.length;
    this.#modifiers = this.#modifiers.filter((modifier) => modifier.duration !== ModifierDuration.END_OF_TURN);
    return this.#modifiers.length !== before;
  }

  /**
   * @param {number} amount
   * @returns {number} damage actually applied
   */
  takeDamage(amount) {
    const applied = Math.max(0, amount);
    this.damage += applied;
    return applied;
  }

  /**
   * @param {number} amount
   * @returns {number} damage actually removed
   */
  heal(amount) {
    const healed = Math.min(this.damage, Math.max(0, amount));
    this.damage -= healed;
    return healed;
  }

  /** Control reverts to the owner: used when the card leaves the battlefield for the owner's hand. */
  revertControl() {
    this.controllerId = this.ownerId;
  }

  /** Clears the "acted this turn" and "entered this turn" flags. */
  ready() {
    this.exhausted = false;
    this.summoningSick = false;
  }

  /**
   * Changes zone. Leaving the battlefield resets all battlefield-only state.
   * @param {string} zone
   */
  moveTo(zone) {
    if (this.zone === ZoneType.BATTLEFIELD && zone !== ZoneType.BATTLEFIELD) {
      this.damage = 0;
      this.#modifiers = [];
      this.summoningSick = false;
      this.exhausted = false;
    }
    this.zone = zone;
  }

  clone() {
    const copy = new CardInstance({
      instanceId: this.instanceId,
      definition: this.definition,
      ownerId: this.ownerId,
      controllerId: this.controllerId,
      zone: this.zone,
    });
    copy.damage = this.damage;
    copy.summoningSick = this.summoningSick;
    copy.exhausted = this.exhausted;
    copy.#modifiers = this.#modifiers.map((modifier) => ({ ...modifier }));
    return copy;
  }

  /** @param {"attack" | "health"} stat */
  #sum(stat) {
    return this.#modifiers.reduce((total, modifier) => total + modifier[stat], 0);
  }
}
