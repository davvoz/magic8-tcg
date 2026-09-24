/**
 * DeckRepository backed by the player's account on the game server.
 *
 * Reads come from a cache filled by `refresh()` (the deck screens read
 * synchronously while they draw); writes go to the server first and update
 * the cache only with what the server accepted, including its version for
 * the next optimistic-concurrency check.
 *
 * Server ids are UUIDs; engine deck ids allow only [a-z0-9_], so a server
 * deck is known locally as "d_" + its UUID without dashes. A draft with any
 * other id (a new deck, a copy) is created on save and comes back with its
 * server identity.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { validateDeckList } from "@magic8/engine/domain/decks/validateDeckList.js";

export const RemoteDeckError = Object.freeze({
  NOT_FOUND: "DECK_NOT_FOUND",
  BAD_DECK: "BAD_DECK",
});

const CLIENT_ID_PREFIX = "d_";

/** @param {string} serverId */
export const clientDeckId = (serverId) => `${CLIENT_ID_PREFIX}${serverId.replaceAll("-", "")}`;

/**
 * @typedef {Readonly<{ serverId: string, version: number, playable: boolean, problems: readonly import("../../application/ports/CollectionApi.contract.js").DeckProblem[] }>} DeckRef
 */

/** @implements {import("../../application/ports/DeckRepository.contract.js").DeckRepository} */
export class RemoteDeckRepository {
  #api;
  /** @type {readonly import("@magic8/engine/domain/decks/DeckList.js").DeckList[]} */
  #decks = Object.freeze([]);
  /** @type {Map<string, DeckRef>} client id → server identity */
  #refs = new Map();

  /** @param {{ api: import("../../application/ports/CollectionApi.contract.js").CollectionApi }} deps */
  constructor({ api }) {
    this.#api = api;
  }

  /** Reloads the account's decks from the server. */
  async refresh() {
    const listed = await this.#api.listDecks();
    if (!listed.ok) {
      return listed;
    }
    this.clear();
    for (const deck of listed.value) {
      const adopted = this.#adopt(deck);
      if (!adopted.ok) {
        return adopted;
      }
    }
    return ok(this.#decks);
  }

  /** Forgets everything (sign-out). */
  clear() {
    this.#decks = Object.freeze([]);
    this.#refs.clear();
  }

  list() {
    return ok(this.#decks);
  }

  /**
   * What the server last said about a deck (version, playability), if it is an account deck.
   * @param {string} deckId client id
   * @returns {DeckRef | undefined}
   */
  describe(deckId) {
    return this.#refs.get(deckId);
  }

  /** @param {import("@magic8/engine/domain/decks/DeckList.js").DeckList} deck */
  async save(deck) {
    const input = Object.freeze({ name: deck.name, faction: deck.faction, cards: deck.entries });
    const ref = this.#refs.get(deck.id);
    const saved = ref === undefined ? await this.#api.createDeck(input) : await this.#api.updateDeck(ref.serverId, ref.version, input);
    return saved.ok ? this.#adopt(saved.value) : saved;
  }

  /** @param {string} deckId client id */
  async remove(deckId) {
    const ref = this.#refs.get(deckId);
    if (ref === undefined) {
      return fail(RemoteDeckError.NOT_FOUND, `no account deck "${deckId}"`);
    }
    const removed = await this.#api.deleteDeck(ref.serverId);
    if (!removed.ok) {
      return removed;
    }
    this.#refs.delete(deckId);
    this.#decks = Object.freeze(this.#decks.filter((deck) => deck.id !== deckId));
    return ok(undefined);
  }

  /**
   * Stores a server deck in the cache, replacing any older copy.
   * @param {import("../../application/ports/CollectionApi.contract.js").AccountDeck} deck
   */
  #adopt(deck) {
    const id = clientDeckId(deck.id);
    const list = validateDeckList({ id, name: deck.name, faction: deck.faction, cards: deck.cards }, { requireSchemaVersion: false });
    if (!list.ok) {
      return fail(RemoteDeckError.BAD_DECK, `the server sent a malformed deck: ${list.error.message}`);
    }
    this.#refs.set(id, Object.freeze({ serverId: deck.id, version: deck.version, playable: deck.playable, problems: deck.problems }));
    this.#decks = Object.freeze([...this.#decks.filter((existing) => existing.id !== id), list.value]);
    return ok(list.value);
  }
}
