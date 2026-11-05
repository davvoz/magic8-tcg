/**
 * DeckService: a user's decks (docs/tcg/02-protocollo-multiplayer.md §2).
 *
 * Every write runs in one unit of work under a per-owner lock, so the
 * ownership check and the deck limit hold even for concurrent requests.
 * Updates are compare-and-set on the version the client last saw
 * (If-Match): a stale editor cannot overwrite a newer save.
 *
 * A house account (docs/tcg/25-bot.md) also has the house's decks: stored
 * among its own (games and the queue refer to a stored deck), brought in
 * line with their data whenever the account's decks are read, playable
 * without owning their cards, and never changed or deleted by hand. Each
 * one's id is a UUID made from the account and the deck's own id.
 */
import { AppError } from "../../../kernel/AppError.js";
import { assertImplements } from "../../../kernel/contracts.js";
import { isUuid, uuidFromName, uuidV4 } from "../../../kernel/random.js";
import { evaluateDeck, missingCards, parseDeckDraft, toDeckList } from "../domain/deckPolicy.js";
import { DECK_REPOSITORY_METHODS } from "./ports.js";

/**
 * @typedef {Readonly<{
 *   id: string,
 *   name: string,
 *   cards: readonly Readonly<{ cardId: string, count: number }>[],
 *   version: number,
 *   createdAt: number,
 *   updatedAt: number,
 *   playable: boolean,
 *   problems: import("../domain/deckPolicy.js").DeckEvaluation["problems"],
 * }>} DeckView
 */

export class DeckService {
  #repository;
  #ownedCards;
  #content;
  #random;
  #clock;
  #unitOfWork;
  #houseDecks;

  /**
   * @param {{
   *   repository: import("./ports.js").DeckRepository,
   *   ownedCards: (userId: string) => Promise<ReadonlyMap<string, number>>,
   *   houseDecks?: (userId: string) => Promise<readonly import("@magic8/engine/domain/decks/DeckList.js").DeckList[]>,
   *   content: () => import("@magic8/engine/domain/content/GameContent.js").GameContent,
   *   random: import("../../../kernel/random.js").SecureRandom,
   *   clock: import("../../../kernel/time.js").Clock,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   * }} deps `houseDecks`: the house's decks the user plays (none but for a house account)
   */
  constructor({ repository, ownedCards, houseDecks = async () => [], content, random, clock, unitOfWork }) {
    assertImplements(repository, DECK_REPOSITORY_METHODS, "DeckRepository");
    this.#repository = repository;
    this.#ownedCards = ownedCards;
    this.#content = content;
    this.#random = random;
    this.#clock = clock;
    this.#unitOfWork = unitOfWork;
    this.#houseDecks = houseDecks;
  }

  /**
   * @param {string} userId
   * @returns {Promise<Readonly<{ decks: readonly DeckView[], limit: number }>>}
   */
  async list(userId) {
    const house = await this.#syncHouse(userId);
    const [decks, owned] = await Promise.all([this.#repository.list(userId), this.#ownedCards(userId)]);
    const views = decks.map((deck) => this.#view(deck, house.has(deck.id) ? cardsOf(deck) : owned));
    return Object.freeze({ decks: Object.freeze(views), limit: this.#content().deckRules.maxSavedDecks });
  }

  /**
   * @param {string} userId
   * @param {unknown} deckId
   * @returns {Promise<DeckView>}
   */
  async get(userId, deckId) {
    const house = await this.#syncHouse(userId);
    const deck = await this.#find(userId, deckId);
    return this.#view(deck, house.has(deck.id) ? cardsOf(deck) : await this.#ownedCards(userId));
  }

  /**
   * @param {string} userId
   * @param {{ name: unknown, cards: unknown }} input
   * @returns {Promise<DeckView>}
   */
  async create(userId, input) {
    const draft = this.#parse(input);
    return this.#unitOfWork(async () => {
      await this.#repository.lockOwner(userId);
      const owned = await this.#requireOwnership(userId, draft);
      const limit = this.#content().deckRules.maxSavedDecks;
      if ((await this.#repository.countActive(userId)) >= limit) {
        throw new AppError("LIMIT_REACHED", `you can keep at most ${limit} decks`);
      }
      const now = this.#clock.now();
      const deck = Object.freeze({ id: uuidV4(this.#random), ownerId: userId, ...draft, version: 1, createdAt: now, updatedAt: now });
      await this.#repository.insert(deck);
      return this.#view(deck, owned);
    });
  }

  /**
   * @param {string} userId
   * @param {unknown} deckId
   * @param {number} expectedVersion
   * @param {{ name: unknown, cards: unknown }} input
   * @returns {Promise<DeckView>}
   */
  async update(userId, deckId, expectedVersion, input) {
    const draft = this.#parse(input);
    return this.#unitOfWork(async () => {
      await this.#repository.lockOwner(userId);
      await this.#refuseHouseDeck(userId, deckId);
      const current = await this.#find(userId, deckId);
      if (current.version !== expectedVersion) {
        throw new AppError("PRECONDITION_FAILED", "the deck was changed elsewhere; reload it", { version: current.version });
      }
      const owned = await this.#requireOwnership(userId, draft);
      const updated = await this.#repository.update({ id: current.id, ownerId: userId, ...draft, updatedAt: this.#clock.now() }, expectedVersion);
      if (updated === null) {
        throw new AppError("PRECONDITION_FAILED", "the deck was changed elsewhere; reload it");
      }
      return this.#view(updated, owned);
    });
  }

  /**
   * @param {string} userId
   * @param {unknown} deckId
   */
  async remove(userId, deckId) {
    await this.#refuseHouseDeck(userId, deckId);
    const removed = isUuid(deckId) && (await this.#repository.softDelete(userId, deckId, this.#clock.now()));
    if (!removed) {
      throw new AppError("NOT_FOUND", "no such deck");
    }
  }

  /**
   * The engine's deck list of a playable deck, for starting a game.
   * @param {string} userId
   * @param {unknown} deckId
   */
  async playableDeckList(userId, deckId) {
    const view = await this.get(userId, deckId);
    if (!view.playable) {
      throw new AppError("VALIDATION", "this deck cannot be played yet", { problems: view.problems });
    }
    return toDeckList({ name: view.name, entries: view.cards });
  }

  /** @param {{ name: unknown, cards: unknown }} input */
  #parse(input) {
    const parsed = parseDeckDraft(input, this.#content().deckRules);
    if (!parsed.ok) {
      throw new AppError("VALIDATION", parsed.error.message);
    }
    const entries = [...parsed.value.entries].sort((a, b) => (a.cardId < b.cardId ? -1 : 1));
    return Object.freeze({ ...parsed.value, entries: Object.freeze(entries) });
  }

  /**
   * @param {string} userId
   * @param {import("../domain/deckPolicy.js").DeckDraft} draft
   */
  async #requireOwnership(userId, draft) {
    const owned = await this.#ownedCards(userId);
    const missing = missingCards(draft, owned);
    if (missing.length > 0) {
      throw new AppError("CARDS_NOT_OWNED", "the deck uses cards you do not own", { missing });
    }
    return owned;
  }

  /**
   * @param {string} userId
   * @param {unknown} deckId
   */
  async #find(userId, deckId) {
    const deck = isUuid(deckId) ? await this.#repository.find(userId, deckId) : null;
    if (deck === null) {
      throw new AppError("NOT_FOUND", "no such deck");
    }
    return deck;
  }

  /**
   * @param {import("./ports.js").StoredDeck} deck
   * @param {ReadonlyMap<string, number>} owned
   * @returns {DeckView}
   */
  #view(deck, owned) {
    const evaluation = evaluateDeck(deck, this.#content(), owned);
    return Object.freeze({
      id: deck.id,
      name: deck.name,
      cards: deck.entries,
      version: deck.version,
      createdAt: deck.createdAt,
      updatedAt: deck.updatedAt,
      playable: evaluation.playable,
      problems: evaluation.problems,
    });
  }

  /**
   * Stores the user's house decks as their data has them (none for most users).
   * @param {string} userId
   * @returns {Promise<ReadonlySet<string>>} the ids of the user's house decks
   */
  async #syncHouse(userId) {
    const house = await this.#houseDecks(userId);
    if (house.length === 0) {
      return NO_HOUSE_DECKS;
    }
    return this.#unitOfWork(async () => {
      await this.#repository.lockOwner(userId);
      const ids = new Set();
      for (const deck of house) {
        const id = houseDeckId(userId, deck);
        ids.add(id);
        const entries = Object.freeze([...deck.entries].sort((a, b) => (a.cardId < b.cardId ? -1 : 1)));
        const stored = await this.#repository.find(userId, id);
        const now = this.#clock.now();
        if (stored === null) {
          await this.#repository.insert(Object.freeze({ id, ownerId: userId, name: deck.name, entries, version: 1, createdAt: now, updatedAt: now }));
        } else if (stored.name !== deck.name || !sameCards(stored, entries)) {
          await this.#repository.update({ id, ownerId: userId, name: deck.name, entries, updatedAt: now }, stored.version);
        }
      }
      return ids;
    });
  }

  /**
   * @param {string} userId
   * @param {unknown} deckId
   */
  async #refuseHouseDeck(userId, deckId) {
    if ((await this.#houseDecks(userId)).some((deck) => houseDeckId(userId, deck) === deckId)) {
      throw new AppError("FORBIDDEN", "the house's decks cannot be changed");
    }
  }
}

/** @type {ReadonlySet<string>} */
const NO_HOUSE_DECKS = Object.freeze(new Set());

/**
 * The id a house deck is stored under for a user: the same every time.
 * @param {string} userId
 * @param {import("@magic8/engine/domain/decks/DeckList.js").DeckList} deck
 */
function houseDeckId(userId, deck) {
  return uuidFromName(`house-deck:${userId}:${deck.id}`);
}

/**
 * @param {import("./ports.js").StoredDeck} stored
 * @param {readonly Readonly<{ cardId: string, count: number }>[]} entries
 */
function sameCards(stored, entries) {
  const cards = cardsOf(stored);
  return cards.size === entries.length && entries.every((entry) => cards.get(entry.cardId) === entry.count);
}

/**
 * A house deck's cards, as if they were the user's.
 * @param {import("./ports.js").StoredDeck} deck
 */
function cardsOf(deck) {
  return new Map(deck.entries.map((entry) => [entry.cardId, entry.count]));
}
