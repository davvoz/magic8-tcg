/**
 * A deck's faction mix: how many of its cards belong to each faction. Decks
 * have no faction of their own; the mix is what shows what a deck is made of
 * (the coloured band on every deck row).
 */

/**
 * @typedef {Readonly<{ faction: string, count: number }>} FactionShare
 */

/**
 * Copies per faction, in the rules' faction order; factions with no card
 * are left out, and so are cards the catalog does not know.
 * @param {readonly Readonly<{ cardId: string, count: number }>[]} entries
 * @param {{ get: (cardId: string) => Readonly<{ faction: string }> | undefined }} catalog
 * @param {readonly string[]} factions
 * @returns {readonly FactionShare[]}
 */
export function factionMix(entries, catalog, factions) {
  /** @type {Map<string, number>} */
  const copies = new Map();
  for (const entry of entries) {
    const faction = catalog.get(entry.cardId)?.faction;
    if (faction !== undefined) {
      copies.set(faction, (copies.get(faction) ?? 0) + entry.count);
    }
  }
  return Object.freeze(factions.filter((faction) => copies.has(faction)).map((faction) => Object.freeze({ faction, count: /** @type {number} */ (copies.get(faction)) })));
}
