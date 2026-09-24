import { CardType } from "./CardType.js";

/**
 * Immutable description of a card as printed. Runtime state (damage, buffs,
 * zone) lives on CardInstance, never here. Construct only through
 * validateCardDefinition so every instance is known to be well-formed.
 */
export class CardDefinition {
  /** @type {string} */
  id;
  /** @type {string} */
  name;
  /** @type {string} */
  type;
  /** @type {string} */
  faction;
  /** @type {number} */
  cost;
  /** @type {number} 0 for non-creatures */
  attack;
  /** @type {number} 0 for non-creatures */
  health;
  /** @type {readonly string[]} */
  keywords;
  /** @type {readonly import("./Ability.js").Ability[]} */
  abilities;
  /** @type {string} */
  text;

  /**
   * @param {{ id: string, name: string, type: string, faction: string, cost: number, attack: number, health: number, keywords: readonly string[], abilities: readonly import("./Ability.js").Ability[], text: string }} fields
   */
  constructor({ id, name, type, faction, cost, attack, health, keywords, abilities, text }) {
    this.id = id;
    this.name = name;
    this.type = type;
    this.faction = faction;
    this.cost = cost;
    this.attack = attack;
    this.health = health;
    this.keywords = Object.freeze([...keywords]);
    this.abilities = Object.freeze([...abilities]);
    this.text = text;
    Object.freeze(this);
  }

  get isCreature() {
    return this.type === CardType.CREATURE;
  }

  get isSpell() {
    return this.type === CardType.SPELL;
  }

  /** @param {string} keyword */
  hasKeyword(keyword) {
    return this.keywords.includes(keyword);
  }

  /**
   * @param {string} trigger
   * @returns {readonly import("./Ability.js").Ability[]}
   */
  abilitiesFor(trigger) {
    return this.abilities.filter((ability) => ability.trigger === trigger);
  }

  /** Abilities whose targets the player must choose when playing the card. */
  get playerTargetedAbilities() {
    return this.abilities.filter((ability) => ability.requiresTarget && !ability.target.isAutomatic);
  }
}
