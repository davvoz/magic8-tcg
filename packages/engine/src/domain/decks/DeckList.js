/**
 * A deck as a list of (cardId, count) entries. Immutable: editing operations
 * return a new DeckList, which keeps the deck builder's draft handling and
 * persistence simple and makes "unsaved changes" a plain reference comparison.
 *
 * Structural validity (ids, counts, uniqueness) is guaranteed by
 * validateDeckList; rule validity (size, copies, factions) is a separate
 * concern handled by DeckValidator against a CardCatalog and DeckRules.
 */
export class DeckList {
  /** @type {string} */
  id;
  /** @type {string} */
  name;
  /** @type {string} */
  faction;
  /** @type {boolean} */
  preconstructed;
  /** @type {readonly Readonly<{ cardId: string, count: number }>[]} */
  entries;

  /**
   * @param {{ id: string, name: string, faction: string, preconstructed?: boolean, entries?: readonly { cardId: string, count: number }[] }} fields
   */
  constructor({ id, name, faction, preconstructed = false, entries = [] }) {
    this.id = id;
    this.name = name;
    this.faction = faction;
    this.preconstructed = preconstructed;
    this.entries = Object.freeze(entries.map((entry) => Object.freeze({ cardId: entry.cardId, count: entry.count })));
    Object.freeze(this);
  }

  get totalCards() {
    return this.entries.reduce((sum, entry) => sum + entry.count, 0);
  }

  /** @param {string} cardId */
  countOf(cardId) {
    return this.entries.find((entry) => entry.cardId === cardId)?.count ?? 0;
  }

  /**
   * @param {string} cardId
   * @returns {DeckList}
   */
  withCardAdded(cardId) {
    const existing = this.entries.find((entry) => entry.cardId === cardId);
    const entries = existing
      ? this.entries.map((entry) => (entry.cardId === cardId ? { cardId, count: entry.count + 1 } : entry))
      : [...this.entries, { cardId, count: 1 }];
    return this.#copyWith({ entries });
  }

  /**
   * Removes one copy; entries that reach zero disappear.
   * @param {string} cardId
   * @returns {DeckList}
   */
  withCardRemoved(cardId) {
    const entries = this.entries
      .map((entry) => (entry.cardId === cardId ? { cardId, count: entry.count - 1 } : entry))
      .filter((entry) => entry.count > 0);
    return this.#copyWith({ entries });
  }

  /**
   * @param {string} name
   * @returns {DeckList}
   */
  withName(name) {
    return this.#copyWith({ name });
  }

  /**
   * @param {string} faction
   * @returns {DeckList}
   */
  withFaction(faction) {
    return this.#copyWith({ faction });
  }

  /**
   * @param {string} id
   * @returns {DeckList}
   */
  withId(id) {
    return this.#copyWith({ id });
  }

  /** Plain, JSON-serialisable representation (used by persistence). */
  toPlain() {
    return {
      id: this.id,
      name: this.name,
      faction: this.faction,
      preconstructed: this.preconstructed,
      cards: this.entries.map((entry) => ({ cardId: entry.cardId, count: entry.count })),
    };
  }

  /** @param {Partial<{ id: string, name: string, faction: string, preconstructed: boolean, entries: readonly { cardId: string, count: number }[] }>} changes */
  #copyWith(changes) {
    return new DeckList({
      id: this.id,
      name: this.name,
      faction: this.faction,
      preconstructed: this.preconstructed,
      entries: this.entries,
      ...changes,
    });
  }
}
