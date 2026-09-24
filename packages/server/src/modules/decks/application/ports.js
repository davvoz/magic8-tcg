/**
 * Ports of the decks module.
 *
 * @typedef {Readonly<{
 *   id: string,
 *   ownerId: string,
 *   name: string,
 *   faction: string,
 *   entries: readonly Readonly<{ cardId: string, count: number }>[],
 *   version: number,
 *   createdAt: number,
 *   updatedAt: number,
 * }>} StoredDeck
 *
 * @typedef {object} DeckRepository
 * @property {(ownerId: string) => Promise<void>} lockOwner serialises deck writes of one owner until the transaction ends
 * @property {(ownerId: string) => Promise<number>} countActive
 * @property {(deck: StoredDeck) => Promise<void>} insert
 * @property {(deck: Omit<StoredDeck, "version" | "createdAt">, expectedVersion: number) => Promise<StoredDeck | null>} update
 *   compare-and-set on version; null when the deck is missing, deleted or at another version
 * @property {(ownerId: string, id: string, at: number) => Promise<boolean>} softDelete
 * @property {(ownerId: string, id: string) => Promise<StoredDeck | null>} find
 * @property {(ownerId: string) => Promise<readonly StoredDeck[]>} list most recently updated first
 */

export const DECK_REPOSITORY_METHODS = Object.freeze(["lockOwner", "countActive", "insert", "update", "softDelete", "find", "list"]);
