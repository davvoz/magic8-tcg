/**
 * Use case: build or edit a custom deck. Holds an immutable draft and
 * exposes editing operations, a live validation report, and save. It has no
 * rendering knowledge, so the canvas deck builder, a CLI or a test can drive
 * it the same way.
 *
 * Saving policy: any structurally valid draft can be saved (work in
 * progress is allowed); the report tells the user what is still wrong, and
 * MatchSetupService refuses illegal decks at match time.
 *
 * Ownership: when `ownership()` returns counts (a signed-in player), only
 * owned cards are offered and a deck holds at most the copies owned; the
 * server enforces the same rule on save. Without counts (offline practice)
 * the whole catalog is available.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { DeckList } from "@magic8/engine/domain/decks/DeckList.js";
import { validateDeck } from "@magic8/engine/domain/decks/DeckValidator.js";
import { validateDeckList } from "@magic8/engine/domain/decks/validateDeckList.js";

export const DeckBuildingError = Object.freeze({
  NO_DRAFT: "NO_DRAFT",
  UNKNOWN_CARD: "UNKNOWN_CARD",
  LIMIT_REACHED: "LIMIT_REACHED",
  INVALID_NAME: "INVALID_NAME",
  INVALID_FACTION: "INVALID_FACTION",
  TOO_MANY_DECKS: "TOO_MANY_DECKS",
  NOT_OWNED: "NOT_OWNED",
});

const CUSTOM_ID_PREFIX = "custom_";
const CUSTOM_ID_PATTERN = /^custom_(\d+)$/;

export class DeckBuildingService {
  #content;
  #repository;
  #ownership;
  /** @type {DeckList | null} */
  #draft = null;
  /** @type {DeckList | null} */
  #saved = null;

  /**
   * @param {{
   *   content: import("../content/ContentService.js").GameContent,
   *   repository: import("../ports/DeckRepository.contract.js").DeckRepository,
   *   ownership?: () => ReadonlyMap<string, number> | null,
   * }} deps
   */
  constructor({ content, repository, ownership = () => null }) {
    this.#content = content;
    this.#repository = repository;
    this.#ownership = ownership;
  }

  get draft() {
    return this.#draft;
  }

  get hasUnsavedChanges() {
    return this.#draft !== null && this.#draft !== this.#saved;
  }

  get rules() {
    return this.#content.deckRules;
  }

  /**
   * Starts an empty deck of the given faction.
   * @param {string} faction
   * @param {string} [name]
   */
  startNew(faction, name = "New Deck") {
    if (!this.rules.isDeckFaction(faction)) {
      return fail(DeckBuildingError.INVALID_FACTION, `a deck cannot be built around "${faction}"; choose one of: ${this.rules.deckFactions.join(", ")}`);
    }
    const id = this.#allocateId();
    if (!id.ok) {
      return id;
    }
    this.#draft = new DeckList({ id: id.value, name, faction, entries: [] });
    this.#saved = null;
    return ok(this.#draft);
  }

  /**
   * Edits an existing deck. Preconstructed decks are copied into a new
   * custom deck so the bundled content is never modified.
   * @param {DeckList} deck
   */
  edit(deck) {
    if (!deck.preconstructed) {
      this.#draft = deck;
      this.#saved = deck;
      return ok(deck);
    }
    const id = this.#allocateId();
    if (!id.ok) {
      return id;
    }
    this.#draft = new DeckList({ id: id.value, name: `${deck.name} (copy)`.slice(0, this.rules.deckNameMaxLength), faction: deck.faction, entries: deck.entries });
    this.#saved = null;
    return ok(this.#draft);
  }

  /** @param {string} cardId */
  addCard(cardId) {
    const draft = this.#requireDraft();
    if (!draft.ok) {
      return draft;
    }
    if (!this.#content.catalog.has(cardId)) {
      return fail(DeckBuildingError.UNKNOWN_CARD, `unknown card "${cardId}"`);
    }
    const count = draft.value.countOf(cardId);
    if (count >= this.rules.maxCopies) {
      return fail(DeckBuildingError.LIMIT_REACHED, `at most ${this.rules.maxCopies} copies of a card`);
    }
    if (count >= this.#copyLimit(cardId)) {
      return fail(DeckBuildingError.NOT_OWNED, `you own ${count} ${count === 1 ? "copy" : "copies"} of this card`);
    }
    if (draft.value.totalCards >= this.rules.maxSize) {
      return fail(DeckBuildingError.LIMIT_REACHED, `at most ${this.rules.maxSize} cards in a deck`);
    }
    this.#draft = draft.value.withCardAdded(cardId);
    return ok(this.#draft);
  }

  /** @param {string} cardId */
  removeCard(cardId) {
    const draft = this.#requireDraft();
    if (!draft.ok) {
      return draft;
    }
    this.#draft = draft.value.withCardRemoved(cardId);
    return ok(this.#draft);
  }

  /** @param {string} name */
  rename(name) {
    const draft = this.#requireDraft();
    if (!draft.ok) {
      return draft;
    }
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (trimmed.length === 0 || trimmed.length > this.rules.deckNameMaxLength) {
      return fail(DeckBuildingError.INVALID_NAME, `name must be 1..${this.rules.deckNameMaxLength} characters`);
    }
    this.#draft = draft.value.withName(trimmed);
    return ok(this.#draft);
  }

  /** @param {string} faction */
  setFaction(faction) {
    const draft = this.#requireDraft();
    if (!draft.ok) {
      return draft;
    }
    if (!this.rules.isDeckFaction(faction)) {
      return fail(DeckBuildingError.INVALID_FACTION, `a deck cannot be built around "${faction}"; choose one of: ${this.rules.deckFactions.join(", ")}`);
    }
    this.#draft = draft.value.withFaction(faction);
    return ok(this.#draft);
  }

  /** Drops the draft (saved or not); the repository is untouched. */
  discard() {
    this.#draft = null;
    this.#saved = null;
  }

  /** Rule-level report for the current draft. */
  report() {
    return this.#draft === null ? null : validateDeck(this.#draft, this.rules, this.#content.catalog);
  }

  /** Cards the draft may still add (respecting copies, ownership, size and faction). */
  addableCardIds() {
    const draft = this.#draft;
    if (draft === null || draft.totalCards >= this.rules.maxSize) {
      return Object.freeze([]);
    }
    return Object.freeze(
      this.#eligibleCards(draft)
        .filter((definition) => draft.countOf(definition.id) < this.#copyLimit(definition.id))
        .map((definition) => definition.id),
    );
  }

  /**
   * Read-model for the card browser: every card the draft's faction may
   * use (rule-eligible types and factions, owned when ownership applies),
   * with how many copies the draft holds, how many it may hold and whether
   * one more may be added. Sorted by cost, then name.
   * @returns {readonly Readonly<{ card: import("@magic8/engine/domain/cards/CardDefinition.js").CardDefinition, count: number, limit: number, canAdd: boolean }>[]}
   */
  browse() {
    const draft = this.#draft;
    if (draft === null) {
      return Object.freeze([]);
    }
    const roomLeft = draft.totalCards < this.rules.maxSize;
    return Object.freeze(
      this.#eligibleCards(draft)
        .sort((left, right) => left.cost - right.cost || left.name.localeCompare(right.name))
        .map((card) => {
          const count = draft.countOf(card.id);
          const limit = this.#copyLimit(card.id);
          return Object.freeze({ card, count, limit, canAdd: roomLeft && count < limit });
        }),
    );
  }

  /**
   * Stores the draft; the stored deck (which may carry a new id, e.g. a
   * server identity) becomes the draft's saved state.
   */
  async save() {
    const draft = this.#requireDraft();
    if (!draft.ok) {
      return draft;
    }
    const structural = validateDeckList(draft.value.toPlain(), { requireSchemaVersion: false });
    if (!structural.ok) {
      return structural;
    }
    const existing = this.#repository.list();
    if (!existing.ok) {
      return existing;
    }
    const isNew = !existing.value.some((deck) => deck.id === draft.value.id);
    if (isNew && existing.value.length >= this.rules.maxSavedDecks) {
      return fail(DeckBuildingError.TOO_MANY_DECKS, `at most ${this.rules.maxSavedDecks} saved decks`);
    }
    const saved = await this.#repository.save(draft.value);
    if (!saved.ok) {
      return saved;
    }
    if (this.#draft === draft.value) {
      this.#draft = saved.value;
    } else if (this.#draft !== null) {
      // Edited while saving: keep the edits, under the stored identity.
      this.#draft = this.#draft.withId(saved.value.id);
    }
    this.#saved = saved.value;
    return ok(saved.value);
  }

  /** @param {string} deckId */
  async delete(deckId) {
    const result = await this.#repository.remove(deckId);
    if (result.ok && this.#draft?.id === deckId) {
      this.#draft = null;
      this.#saved = null;
    }
    return result;
  }

  /** @param {DeckList} draft */
  #eligibleCards(draft) {
    const owned = this.#ownership();
    return this.#content.catalog
      .all()
      .filter((definition) => this.rules.allowedTypes.includes(definition.type))
      .filter((definition) => this.rules.allowsFaction(draft.faction, definition.faction))
      .filter((definition) => owned === null || (owned.get(definition.id) ?? 0) > 0);
  }

  /**
   * Copies of a card a deck may hold: the rule's limit, capped by ownership.
   * @param {string} cardId
   */
  #copyLimit(cardId) {
    const owned = this.#ownership();
    return owned === null ? this.rules.maxCopies : Math.min(this.rules.maxCopies, owned.get(cardId) ?? 0);
  }

  #requireDraft() {
    return this.#draft === null ? fail(DeckBuildingError.NO_DRAFT, "no deck is being edited") : ok(this.#draft);
  }

  /** Next free custom id, derived from what is stored (no clock, no randomness). */
  #allocateId() {
    const existing = this.#repository.list();
    if (!existing.ok) {
      return existing;
    }
    const highest = existing.value
      .map((deck) => CUSTOM_ID_PATTERN.exec(deck.id))
      .filter((match) => match !== null)
      .reduce((max, match) => Math.max(max, Number.parseInt(match[1], 10)), 0);
    return ok(`${CUSTOM_ID_PREFIX}${highest + 1}`);
  }
}
