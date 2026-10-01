/**
 * DeckService: a user's decks (docs/tcg/02-protocollo-multiplayer.md §2).
 *
 * Every write runs in one unit of work under a per-owner lock, so the
 * ownership check and the deck limit hold even for concurrent requests.
 * Updates are compare-and-set on the version the client last saw
 * (If-Match): a stale editor cannot overwrite a newer save.
 */
import { AppError } from "../../../kernel/AppError.js";
import { assertImplements } from "../../../kernel/contracts.js";
import { isUuid, uuidV4 } from "../../../kernel/random.js";
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

  /**
   * @param {{
   *   repository: import("./ports.js").DeckRepository,
   *   ownedCards: (userId: string) => Promise<ReadonlyMap<string, number>>,
   *   content: () => import("@magic8/engine/domain/content/GameContent.js").GameContent,
   *   random: import("../../../kernel/random.js").SecureRandom,
   *   clock: import("../../../kernel/time.js").Clock,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   * }} deps
   */
  constructor({ repository, ownedCards, content, random, clock, unitOfWork }) {
    assertImplements(repository, DECK_REPOSITORY_METHODS, "DeckRepository");
    this.#repository = repository;
    this.#ownedCards = ownedCards;
    this.#content = content;
    this.#random = random;
    this.#clock = clock;
    this.#unitOfWork = unitOfWork;
  }

  /**
   * @param {string} userId
   * @returns {Promise<Readonly<{ decks: readonly DeckView[], limit: number }>>}
   */
  async list(userId) {
    const [decks, owned] = await Promise.all([this.#repository.list(userId), this.#ownedCards(userId)]);
    return Object.freeze({ decks: Object.freeze(decks.map((deck) => this.#view(deck, owned))), limit: this.#content().deckRules.maxSavedDecks });
  }

  /**
   * @param {string} userId
   * @param {unknown} deckId
   * @returns {Promise<DeckView>}
   */
  async get(userId, deckId) {
    const deck = await this.#find(userId, deckId);
    return this.#view(deck, await this.#ownedCards(userId));
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
}
