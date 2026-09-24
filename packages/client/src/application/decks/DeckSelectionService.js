/**
 * Read-model for the deck selection screen: every deck the player can pick,
 * with its source and its rule-level report, so the UI can show why a saved
 * deck is not currently playable (e.g. after a content change).
 */
import { validateDeck } from "@magic8/engine/domain/decks/DeckValidator.js";

export const DeckSource = Object.freeze({
  PRECONSTRUCTED: "preconstructed",
  CUSTOM: "custom",
});

/**
 * @typedef {Readonly<{ deck: import("@magic8/engine/domain/decks/DeckList.js").DeckList, source: string, report: import("@magic8/engine/domain/decks/DeckValidator.js").DeckValidationReport }>} DeckOption
 */

export class DeckSelectionService {
  #content;
  #repository;
  #logger;

  /**
   * @param {{ content: import("../content/ContentService.js").GameContent, repository: import("../ports/DeckRepository.contract.js").DeckRepository, logger: import("../ports/Logger.contract.js").Logger }} deps
   */
  constructor({ content, repository, logger }) {
    this.#content = content;
    this.#repository = repository;
    this.#logger = logger;
  }

  /** @returns {readonly DeckOption[]} preconstructed decks first, then custom decks */
  listDecks() {
    const precon = this.#content.preconDecks.map((deck) => this.#option(deck, DeckSource.PRECONSTRUCTED));
    const stored = this.#repository.list();
    if (!stored.ok) {
      this.#logger.warn("could not list saved decks", stored.error);
      return Object.freeze(precon);
    }
    return Object.freeze([...precon, ...stored.value.map((deck) => this.#option(deck, DeckSource.CUSTOM))]);
  }

  /** @returns {readonly DeckOption[]} only decks that can start a match */
  listPlayableDecks() {
    return Object.freeze(this.listDecks().filter((option) => option.report.valid));
  }

  /**
   * @param {string} deckId
   * @returns {DeckOption | undefined}
   */
  find(deckId) {
    return this.listDecks().find((option) => option.deck.id === deckId);
  }

  /**
   * @param {import("@magic8/engine/domain/decks/DeckList.js").DeckList} deck
   * @param {string} source
   * @returns {DeckOption}
   */
  #option(deck, source) {
    return Object.freeze({ deck, source, report: validateDeck(deck, this.#content.deckRules, this.#content.catalog) });
  }
}
