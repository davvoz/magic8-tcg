/**
 * Port for keeping, between visits, the deck the player last chose to play
 * with (SelectedDeck). Implemented by StoredSelectedDeck (this browser's
 * storage). What it reads back is untrusted: SelectedDeck parses it.
 *
 * @typedef {object} SelectedDeckPreferences
 * @property {() => unknown} load what was last saved, or null when nothing was
 * @property {(value: Readonly<{ deckId: string }>) => void} save
 */

export const SELECTED_DECK_PREFERENCES_METHODS = Object.freeze(["load", "save"]);
