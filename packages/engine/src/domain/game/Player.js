import { ZONE_TYPES, ZoneType } from "./ZoneType.js";
import { Zone } from "./Zone.js";

/** A participant: identity, life, resources and one zone of each type. */
export class Player {
  /** @type {string} */
  id;
  /** @type {string} */
  name;
  /** @type {number} */
  life;
  /** @type {import("../resources/ResourcePool.js").ResourcePool} */
  resources;
  /** @type {Map<string, Zone>} */
  #zones;

  /**
   * @param {{ id: string, name: string, life: number, resources: import("../resources/ResourcePool.js").ResourcePool, zones?: ReadonlyMap<string, Zone> }} fields
   */
  constructor({ id, name, life, resources, zones }) {
    this.id = id;
    this.name = name;
    this.life = life;
    this.resources = resources;
    this.#zones = new Map(ZONE_TYPES.map((type) => [type, zones?.get(type) ?? new Zone(type)]));
  }

  /**
   * @param {string} type One of ZoneType.
   * @returns {Zone}
   */
  zone(type) {
    const zone = this.#zones.get(type);
    if (zone === undefined) {
      throw new RangeError(`Player ${this.id}: unknown zone "${type}"`);
    }
    return zone;
  }

  get library() {
    return this.zone(ZoneType.LIBRARY);
  }

  get hand() {
    return this.zone(ZoneType.HAND);
  }

  get battlefield() {
    return this.zone(ZoneType.BATTLEFIELD);
  }

  get graveyard() {
    return this.zone(ZoneType.GRAVEYARD);
  }

  /** Creatures currently under this player's control on the battlefield. */
  get creatures() {
    return this.battlefield.cards.filter((card) => card.isCreature);
  }

  /**
   * @param {string} instanceId
   * @returns {import("../cards/CardInstance.js").CardInstance | undefined}
   */
  findCard(instanceId) {
    for (const zone of this.#zones.values()) {
      const card = zone.find(instanceId);
      if (card !== undefined) {
        return card;
      }
    }
    return undefined;
  }

  /**
   * @param {number} amount
   * @returns {number} life actually lost
   */
  loseLife(amount) {
    const lost = Math.max(0, amount);
    this.life -= lost;
    return lost;
  }

  /**
   * @param {number} amount
   * @param {number} cap Life cannot exceed this value.
   * @returns {number} life actually gained
   */
  gainLife(amount, cap) {
    const gained = Math.max(0, Math.min(amount, cap - this.life));
    this.life += gained;
    return gained;
  }

  clone() {
    const zones = new Map([...this.#zones].map(([type, zone]) => [type, zone.clone()]));
    return new Player({ id: this.id, name: this.name, life: this.life, resources: this.resources.clone(), zones });
  }
}
