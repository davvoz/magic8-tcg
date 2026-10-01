/**
 * A deck's faction mix as the screens show it: copies per faction, in the
 * rules' faction order. Decks have no faction of their own.
 */
import { factionMix } from "@magic8/engine/domain/decks/factionMix.js";

/**
 * @typedef {import("@magic8/engine/domain/decks/factionMix.js").FactionShare} FactionShare
 */

/**
 * @param {Readonly<{ catalog: import("@magic8/engine/domain/cards/CardCatalog.js").CardCatalog, deckRules: import("@magic8/engine/domain/decks/DeckRules.js").DeckRules }>} content
 * @param {readonly Readonly<{ cardId: string, count: number }>[]} entries
 * @returns {readonly FactionShare[]}
 */
export function deckMix(content, entries) {
  return factionMix(entries, content.catalog, content.deckRules.factions);
}
