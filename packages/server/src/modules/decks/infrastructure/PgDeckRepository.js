/**
 * decks and deck_cards. Updates are compare-and-set on `version`; deletion
 * is soft, because games keep referring to the deck they were played with.
 */
import { fromTimestamp, toTimestamp } from "../../../platform/db/Database.js";

/** Arbitrary namespace for per-owner advisory locks on deck writes. */
const DECK_LOCK_NAMESPACE = 7_310_430;

/**
 * @param {import("../../../platform/db/Database.js").Row} row
 * @param {readonly import("../../../platform/db/Database.js").Row[]} cards
 * @returns {import("../application/ports.js").StoredDeck}
 */
function toDeck(row, cards) {
  return Object.freeze({
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    faction: row.faction,
    entries: Object.freeze(cards.map((card) => Object.freeze({ cardId: card.definition_id, count: card.count }))),
    version: row.version,
    createdAt: fromTimestamp(row.created_at),
    updatedAt: fromTimestamp(row.updated_at),
  });
}

/** @typedef {import("../application/ports.js").DeckRepository} DeckRepository */

/** @implements {DeckRepository} */
export class PgDeckRepository {
  #db;

  /** @param {import("../../../platform/db/Database.js").Database} db */
  constructor(db) {
    this.#db = db;
  }

  async lockOwner(ownerId) {
    await this.#db.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [DECK_LOCK_NAMESPACE, ownerId]);
  }

  async countActive(ownerId) {
    const row = await this.#db.maybeOne("SELECT count(*)::integer AS decks FROM decks WHERE owner_id = $1 AND deleted_at IS NULL", [ownerId]);
    return /** @type {import("../../../platform/db/Database.js").Row} */ (row).decks;
  }

  async insert(deck) {
    await this.#db.query("INSERT INTO decks (id, owner_id, name, faction, version, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
      deck.id,
      deck.ownerId,
      deck.name,
      deck.faction,
      deck.version,
      toTimestamp(deck.createdAt),
      toTimestamp(deck.updatedAt),
    ]);
    await this.#insertCards(deck.id, deck.entries);
  }

  async update(deck, expectedVersion) {
    const row = await this.#db.maybeOne(
      `UPDATE decks SET name = $3, faction = $4, version = version + 1, updated_at = $5
        WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL AND version = $6
       RETURNING *`,
      [deck.id, deck.ownerId, deck.name, deck.faction, toTimestamp(deck.updatedAt), expectedVersion],
    );
    if (row === null) {
      return null;
    }
    await this.#db.query("DELETE FROM deck_cards WHERE deck_id = $1", [deck.id]);
    await this.#insertCards(deck.id, deck.entries);
    return toDeck(row, deck.entries.map((entry) => ({ definition_id: entry.cardId, count: entry.count })));
  }

  async softDelete(ownerId, id, at) {
    const result = await this.#db.query("UPDATE decks SET deleted_at = $3, version = version + 1 WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL", [id, ownerId, toTimestamp(at)]);
    return result.rowCount > 0;
  }

  async find(ownerId, id) {
    const row = await this.#db.maybeOne("SELECT * FROM decks WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL", [id, ownerId]);
    if (row === null) {
      return null;
    }
    const cards = await this.#db.rows("SELECT definition_id, count FROM deck_cards WHERE deck_id = $1 ORDER BY definition_id", [id]);
    return toDeck(row, cards);
  }

  async list(ownerId) {
    const decks = await this.#db.rows("SELECT * FROM decks WHERE owner_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC, id", [ownerId]);
    const cards = await this.#db.rows(
      "SELECT deck_id, definition_id, count FROM deck_cards WHERE deck_id IN (SELECT id FROM decks WHERE owner_id = $1 AND deleted_at IS NULL) ORDER BY deck_id, definition_id",
      [ownerId],
    );
    return Object.freeze(decks.map((deck) => toDeck(deck, cards.filter((card) => card.deck_id === deck.id))));
  }

  /**
   * @param {string} deckId
   * @param {readonly Readonly<{ cardId: string, count: number }>[]} entries
   */
  async #insertCards(deckId, entries) {
    if (entries.length === 0) {
      return;
    }
    await this.#db.query("INSERT INTO deck_cards (deck_id, definition_id, count) SELECT $1, * FROM unnest($2::text[], $3::integer[])", [
      deckId,
      entries.map((entry) => entry.cardId),
      entries.map((entry) => entry.count),
    ]);
  }
}
