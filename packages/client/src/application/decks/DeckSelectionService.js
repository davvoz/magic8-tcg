/**
 * Read-model for the deck selection screen: every deck the player can pick,
 * with its source and its rule-level report, so the UI can show why a saved
 * deck is not currently playable (e.g. after a content change).
 *
 * The preconstructed decks are the player's own only in offline practice.
 * Signed in, the player plays the decks of their account (the starter they
 * took, the decks they built from owned cards): the other preconstructed
 * decks stay out of their lists and only give the AI something to play.
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
  #showPreconstructed;

  /**
   * @param {{ content: import("../content/ContentService.js").GameContent, repository: import("../ports/DeckRepository.contract.js").DeckRepository, logger: import("../ports/Logger.contract.js").Logger, showPreconstructed?: () => boolean }} deps
   *   `showPreconstructed` says whether the preconstructed decks count as the player's (default: always, as offline)
   */
  constructor({ content, repository, logger, showPreconstructed = () => true }) {
    this.#content = content;
    this.#repository = repository;
    this.#logger = logger;
    this.#showPreconstructed = showPreconstructed;
  }

  /** @returns {readonly DeckOption[]} the player's decks: preconstructed decks first (offline only), then custom decks */
  listDecks() {
    const precon = this.#showPreconstructed() ? this.#content.preconDecks.map((deck) => this.#option(deck, DeckSource.PRECONSTRUCTED)) : [];
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

  /** @returns {readonly DeckOption[]} decks the practice AI may play: the playable preconstructed decks, whoever is signed in */
  listRivalDecks() {
    return Object.freeze(this.#content.preconDecks.map((deck) => this.#option(deck, DeckSource.PRECONSTRUCTED)).filter((option) => option.report.valid));
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
