/**
 * DeckRepository over a KeyValueStore. All decks live under one key as a
 * versioned envelope; each stored deck is re-validated with the same
 * structural validator used for bundled content. Corrupt entries are
 * skipped and logged rather than taking the whole collection down.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { validateDeckList } from "@magic8/engine/domain/decks/validateDeckList.js";
import { openEnvelope, sealEnvelope } from "./StorageEnvelope.js";

export const DECKS_STORAGE_KEY = "magic8.decks";
export const DECKS_SCHEMA_VERSION = 1;
const MAX_STORED_BYTES = 256 * 1024;
const MAX_STORED_DECKS = 500;

export const DeckRepositoryError = Object.freeze({
  NOT_FOUND: "DECK_NOT_FOUND",
});

/** @typedef {import("../../application/ports/DeckRepository.contract.js").DeckRepository} DeckRepository */

/** @implements {DeckRepository} */
export class StoredDeckRepository {
  #store;
  #logger;

  /**
   * @param {{ store: import("./KeyValueStore.contract.js").KeyValueStore, logger: import("../../application/ports/Logger.contract.js").Logger }} deps
   */
  constructor({ store, logger }) {
    this.#store = store;
    this.#logger = logger;
  }

  list() {
    const raw = this.#store.read(DECKS_STORAGE_KEY);
    if (!raw.ok) {
      return raw;
    }
    if (raw.value === null) {
      return ok(Object.freeze([]));
    }
    const envelope = openEnvelope(raw.value, { schemaVersion: DECKS_SCHEMA_VERSION, maxBytes: MAX_STORED_BYTES });
    if (!envelope.ok) {
      this.#logger.warn("stored decks discarded", envelope.error);
      return ok(Object.freeze([]));
    }
    return ok(this.#decodeDecks(envelope.value));
  }

  /** @param {import("@magic8/engine/domain/decks/DeckList.js").DeckList} deck */
  save(deck) {
    const existing = this.list();
    if (!existing.ok) {
      return existing;
    }
    const others = existing.value.filter((stored) => stored.id !== deck.id);
    const written = this.#write([...others, deck]);
    return written.ok ? ok(deck) : written;
  }

  /** @param {string} deckId */
  remove(deckId) {
    const existing = this.list();
    if (!existing.ok) {
      return existing;
    }
    if (!existing.value.some((stored) => stored.id === deckId)) {
      return fail(DeckRepositoryError.NOT_FOUND, `no saved deck "${deckId}"`);
    }
    return this.#write(existing.value.filter((stored) => stored.id !== deckId));
  }

  /**
   * @param {unknown} payload
   * @returns {readonly import("@magic8/engine/domain/decks/DeckList.js").DeckList[]}
   */
  #decodeDecks(payload) {
    if (!Array.isArray(payload)) {
      this.#logger.warn("stored decks payload is not an array");
      return Object.freeze([]);
    }
    const decks = [];
    const seen = new Set();
    for (const [index, raw] of payload.slice(0, MAX_STORED_DECKS).entries()) {
      const result = validateDeckList(raw, { requireSchemaVersion: false });
      if (!result.ok) {
        this.#logger.warn(`stored deck #${index} skipped`, result.error);
        continue;
      }
      if (seen.has(result.value.id) || result.value.preconstructed) {
        this.#logger.warn(`stored deck #${index} skipped: duplicate id or preconstructed flag`);
        continue;
      }
      seen.add(result.value.id);
      decks.push(result.value);
    }
    return Object.freeze(decks);
  }

  /** @param {readonly import("@magic8/engine/domain/decks/DeckList.js").DeckList[]} decks */
  #write(decks) {
    const sealed = sealEnvelope(DECKS_SCHEMA_VERSION, decks.map((deck) => deck.toPlain()), MAX_STORED_BYTES);
    if (!sealed.ok) {
      return sealed;
    }
    return this.#store.write(DECKS_STORAGE_KEY, sealed.value);
  }
}
