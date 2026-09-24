import { fail, ok } from "../../shared/Result.js";

/**
 * Read-only lookup of CardDefinitions by id. Built once from validated
 * definitions; the engine, deck builder and renderer all resolve card ids
 * through it.
 */
export class CardCatalog {
  /** @type {Map<string, import("./CardDefinition.js").CardDefinition>} */
  #byId;

  /** @param {Map<string, import("./CardDefinition.js").CardDefinition>} byId */
  constructor(byId) {
    this.#byId = byId;
    Object.freeze(this);
  }

  /**
   * @param {readonly import("./CardDefinition.js").CardDefinition[]} definitions
   * @returns {import("../../shared/Result.js").Ok<CardCatalog> | import("../../shared/Result.js").Fail}
   */
  static fromDefinitions(definitions) {
    const byId = new Map();
    for (const definition of definitions) {
      if (byId.has(definition.id)) {
        return fail("DUPLICATE_CARD_ID", `duplicate card id "${definition.id}"`, { cardId: definition.id });
      }
      byId.set(definition.id, definition);
    }
    return ok(new CardCatalog(byId));
  }

  /** @param {string} id */
  has(id) {
    return this.#byId.has(id);
  }

  /**
   * @param {string} id
   * @returns {import("./CardDefinition.js").CardDefinition | undefined}
   */
  get(id) {
    return this.#byId.get(id);
  }

  get size() {
    return this.#byId.size;
  }

  /** @returns {readonly import("./CardDefinition.js").CardDefinition[]} in insertion order */
  all() {
    return Object.freeze([...this.#byId.values()]);
  }
}
