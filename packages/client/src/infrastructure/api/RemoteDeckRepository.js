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
  ACCOUNT_CHANGED: "ACCOUNT_CHANGED",
});

const CLIENT_ID_PREFIX = "d_";

/** @param {string} serverId */
export const clientDeckId = (serverId) => `${CLIENT_ID_PREFIX}${serverId.replaceAll("-", "")}`;

/**
 * @typedef {Readonly<{ serverId: string, version: number, playable: boolean, problems: readonly import("../../application/ports/CollectionApi.contract.js").DeckProblem[] }>} DeckRef
 */

/** @typedef {import("../../application/ports/DeckRepository.contract.js").DeckRepository} DeckRepository */

/** @implements {DeckRepository} */
export class RemoteDeckRepository {
  #api;
  /** @type {readonly import("@magic8/engine/domain/decks/DeckList.js").DeckList[]} */
  #decks = Object.freeze([]);
  /** @type {Map<string, DeckRef>} client id → server identity */
  #refs = new Map();
  /** Increases on every clear, so a slow refresh for a previous account is ignored. */
  #generation = 0;

  /** @param {{ api: import("../../application/ports/CollectionApi.contract.js").CollectionApi }} deps */
  constructor({ api }) {
    this.#api = api;
  }

  /** Reloads the account's decks from the server. */
  async refresh() {
    const generation = this.#generation;
    const listed = await this.#api.listDecks();
    if (generation !== this.#generation) {
      // Cleared while loading (sign-out, another account): the answer belongs to nobody now.
      return ok(this.#decks);
    }
    if (!listed.ok) {
      return listed;
    }
    this.#decks = Object.freeze([]);
    this.#refs.clear();
    for (const deck of listed.value) {
      const adopted = this.#adopt(deck);
      if (!adopted.ok) {
        return adopted;
      }
    }
    return ok(this.#decks);
  }

  /** Forgets everything (sign-out); a refresh still on its way is ignored. */
  clear() {
    this.#generation += 1;
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
    const input = Object.freeze({ name: deck.name, cards: deck.entries });
    const ref = this.#refs.get(deck.id);
    const generation = this.#generation;
    const saved = ref === undefined ? await this.#api.createDeck(input) : await this.#api.updateDeck(ref.serverId, ref.version, input);
    if (generation !== this.#generation) {
      return accountChanged();
    }
    return saved.ok ? this.#adopt(saved.value) : saved;
  }

  /** @param {string} deckId client id */
  async remove(deckId) {
    const ref = this.#refs.get(deckId);
    if (ref === undefined) {
      return fail(RemoteDeckError.NOT_FOUND, `no account deck "${deckId}"`);
    }
    const generation = this.#generation;
    const removed = await this.#api.deleteDeck(ref.serverId);
    if (generation !== this.#generation) {
      return accountChanged();
    }
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
    const list = validateDeckList({ id, name: deck.name, cards: deck.cards }, { requireSchemaVersion: false });
    if (!list.ok) {
      return fail(RemoteDeckError.BAD_DECK, `the server sent a malformed deck: ${list.error.message}`);
    }
    this.#refs.set(id, Object.freeze({ serverId: deck.id, version: deck.version, playable: deck.playable, problems: deck.problems }));
    this.#decks = Object.freeze([...this.#decks.filter((existing) => existing.id !== id), list.value]);
    return ok(list.value);
  }
}

/** A write that finished after the player signed out: the cache it would update is gone. */
function accountChanged() {
  return fail(RemoteDeckError.ACCOUNT_CHANGED, "you signed out before the server answered");
}
