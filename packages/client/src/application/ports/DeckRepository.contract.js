/**
 * Persistence port for custom decks. Implemented by infrastructure: in the
 * browser's storage (StoredDeckRepository) or in the player's account
 * (RemoteDeckRepository); the application never touches storage APIs.
 *
 * `list` is synchronous (screens read it while drawing). `save` and
 * `remove` may complete later: callers always await them. `save` returns
 * the deck as stored, which may carry a new id (a new account deck gets its
 * server identity).
 *
 * @typedef {import("@magic8/engine/domain/decks/DeckList.js").DeckList} DeckList
 * @typedef {import("@magic8/engine/shared/Result.js").Fail} Fail
 * @typedef {object} DeckRepository
 * @property {() => import("@magic8/engine/shared/Result.js").Ok<readonly DeckList[]> | Fail} list
 * @property {(deck: DeckList) => import("@magic8/engine/shared/Result.js").Ok<DeckList> | Fail | Promise<import("@magic8/engine/shared/Result.js").Ok<DeckList> | Fail>} save Inserts or replaces by id.
 * @property {(deckId: string) => import("@magic8/engine/shared/Result.js").Ok<undefined> | Fail | Promise<import("@magic8/engine/shared/Result.js").Ok<undefined> | Fail>} remove
 */

export const DECK_REPOSITORY_METHODS = Object.freeze(["list", "save", "remove"]);
