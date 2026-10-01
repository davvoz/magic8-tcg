/**
 * How a deck's faction mix is shown: a band split among its factions in
 * proportion to their cards, and the same counts in words.
 */
import { factionTones } from "../theme/Theme.js";

/**
 * @typedef {import("../../application/decks/deckMix.js").FactionShare} FactionShare
 * @typedef {import("../ui/OptionRow.js").StripeBand} StripeBand
 */

/**
 * @param {import("../theme/Theme.js").Theme} theme
 * @param {readonly FactionShare[]} mix
 * @returns {readonly StripeBand[]}
 */
export function mixBands(theme, mix) {
  return Object.freeze(mix.map(({ faction, count }) => Object.freeze({ color: factionTones(theme, faction).base, weight: count })));
}

/**
 * "iron 26 · neutral 4"; empty for a deck with no cards.
 * @param {readonly FactionShare[]} mix
 */
export function mixText(mix) {
  return mix.map(({ faction, count }) => `${faction} ${count}`).join(" · ");
}

/**
 * A deck row's subtitle: its size, any notes, then its mix. The mix goes
 * last: on a narrow row it is what gets shortened, never the notes.
 * @param {number} totalCards
 * @param {readonly FactionShare[]} mix
 * @param {readonly string[]} [notes] e.g. "preconstructed", why it cannot be played
 */
export function deckSummary(totalCards, mix, notes = []) {
  return [`${totalCards} ${totalCards === 1 ? "card" : "cards"}`, ...notes, mixText(mix)].filter((part) => part.length > 0).join(" · ");
}
