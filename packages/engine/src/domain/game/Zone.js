/**
 * An ordered collection of CardInstances. Index 0 is the "top" of a library.
 * The size cap is a structural guard, not a game rule.
 */
const MAX_ZONE_SIZE = 1000;

export class Zone {
  /** @type {string} */
  type;
  /** @type {import("../cards/CardInstance.js").CardInstance[]} */
  #cards;

  /**
   * @param {string} type
   * @param {readonly import("../cards/CardInstance.js").CardInstance[]} [cards]
   */
  constructor(type, cards = []) {
    this.type = type;
    this.#cards = [...cards];
  }

  get size() {
    return this.#cards.length;
  }

  get isEmpty() {
    return this.#cards.length === 0;
  }

  /** @returns {readonly import("../cards/CardInstance.js").CardInstance[]} a copy in zone order */
  get cards() {
    return Object.freeze([...this.#cards]);
  }

  /** @param {string} instanceId */
  contains(instanceId) {
    return this.#cards.some((card) => card.instanceId === instanceId);
  }

  /** @param {string} instanceId */
  find(instanceId) {
    return this.#cards.find((card) => card.instanceId === instanceId);
  }

  /**
   * Appends to the bottom and updates the card's zone marker.
   * @param {import("../cards/CardInstance.js").CardInstance} card
   */
  add(card) {
    if (this.#cards.length >= MAX_ZONE_SIZE) {
      throw new RangeError(`Zone ${this.type}: size limit reached`);
    }
    card.moveTo(this.type);
    this.#cards.push(card);
  }

  /**
   * @param {string} instanceId
   * @returns {import("../cards/CardInstance.js").CardInstance | undefined}
   */
  remove(instanceId) {
    const index = this.#cards.findIndex((card) => card.instanceId === instanceId);
    if (index === -1) {
      return undefined;
    }
    return this.#cards.splice(index, 1)[0];
  }

  /** @returns {import("../cards/CardInstance.js").CardInstance | undefined} */
  takeTop() {
    return this.#cards.shift();
  }

  /** @returns {import("../cards/CardInstance.js").CardInstance | undefined} */
  takeBottom() {
    return this.#cards.pop();
  }

  clone() {
    return new Zone(this.type, this.#cards.map((card) => card.clone()));
  }
}
