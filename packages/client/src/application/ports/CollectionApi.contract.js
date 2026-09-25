/**
 * The server's collection API as the client application sees it: the
 * starter offer, owned cards and the account's decks. Every method resolves
 * to a Result; the server is the authority on what a player owns.
 *
 * @typedef {Readonly<{ cardId: string, count: number }>} DeckEntry
 * @typedef {Readonly<{ id: string, name: string, faction: string, size: number, cards: readonly DeckEntry[] }>} StarterChoice
 * @typedef {Readonly<{ claimed: boolean, choices: readonly StarterChoice[] }>} StarterStatus
 * @typedef {Readonly<{ id: string, edition: string, serial: number, finish: string, status: string, tradeable?: boolean }>} OwnedCopy tradeable: bought (not a free grant), so it may be offered in a trade
 * @typedef {Readonly<{ definitionId: string, copies: readonly OwnedCopy[] }>} CollectionEntry
 * @typedef {Readonly<{ code: string, message: string, cardId: string | null }>} DeckProblem
 * @typedef {Readonly<{ id: string, name: string, faction: string, cards: readonly DeckEntry[], version: number, playable: boolean, problems: readonly DeckProblem[] }>} AccountDeck
 * @typedef {Readonly<{ name: string, faction: string, cards: readonly DeckEntry[] }>} DeckInput
 *
 * @typedef {import("@magic8/engine/shared/Result.js").Fail} Fail
 * @typedef {object} CollectionApi
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Ok<StarterStatus> | Fail>} starter
 * @property {(starterId: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<Readonly<{ deck: AccountDeck, cardsGranted: number }>> | Fail>} claimStarter
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Ok<readonly CollectionEntry[]> | Fail>} collection
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Ok<readonly AccountDeck[]> | Fail>} listDecks
 * @property {(input: DeckInput) => Promise<import("@magic8/engine/shared/Result.js").Ok<AccountDeck> | Fail>} createDeck
 * @property {(id: string, version: number, input: DeckInput) => Promise<import("@magic8/engine/shared/Result.js").Ok<AccountDeck> | Fail>} updateDeck
 * @property {(id: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<null> | Fail>} deleteDeck
 */

export const COLLECTION_API_METHODS = Object.freeze(["starter", "claimStarter", "collection", "listDecks", "createDeck", "updateDeck", "deleteDeck"]);
