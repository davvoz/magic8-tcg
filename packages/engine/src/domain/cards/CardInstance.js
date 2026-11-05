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
  /** Keywords given while on the battlefield (a match condition), beyond the printed ones. @type {string[]} */
  #granted = [];
  /**
   * What static abilities on the battlefield give it right now (a lord's +1/+1).
   * Derived from the board and recomputed by StaticAbilities, so it is not
   * part of the state digest.
   * @type {{ attack: number, health: number }}
   */
  #staticBonus = { attack: 0, health: 0 };

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
    return Math.max(0, this.definition.attack + this.#sum("attack") + this.#staticBonus.attack);
  }

  get maxHealth() {
    return this.definition.health + this.#sum("health") + this.#staticBonus.health;
  }

  /** @returns {Readonly<{ attack: number, health: number }>} */
  get staticBonus() {
    return Object.freeze({ ...this.#staticBonus });
  }

  /**
   * @param {{ attack: number, health: number }} bonus what static abilities give it now
   * @returns {boolean} whether it changed
   */
  setStaticBonus(bonus) {
    if (bonus.attack === this.#staticBonus.attack && bonus.health === this.#staticBonus.health) {
      return false;
    }
    this.#staticBonus = { attack: bonus.attack, health: bonus.health };
    return true;
  }

  get health() {
    return this.maxHealth - this.damage;
  }

  /** The printed keywords and the granted ones. @returns {readonly string[]} */
  get keywords() {
    return Object.freeze([...new Set([...this.definition.keywords, ...this.#granted])]);
  }

  /** @param {string} keyword one of Keyword */
  hasKeyword(keyword) {
    return this.definition.hasKeyword(keyword) || this.#granted.includes(keyword);
  }

  /**
   * Gives the card a keyword until it leaves the battlefield.
   * @param {string} keyword one of Keyword
   */
  grantKeyword(keyword) {
    if (!this.hasKeyword(keyword)) {
      this.#granted.push(keyword);
    }
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
      this.#granted = [];
      this.#staticBonus = { attack: 0, health: 0 };
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
    copy.#granted = [...this.#granted];
    copy.#staticBonus = { ...this.#staticBonus };
    return copy;
  }

  /** @param {"attack" | "health"} stat */
  #sum(stat) {
    return this.#modifiers.reduce((total, modifier) => total + modifier[stat], 0);
  }
}
