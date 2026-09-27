/**
 * Claiming the free starter deck. One unit of work: record the grant (its
 * key makes a second claim impossible, even concurrently), mint the cards,
 * save them as a ready-to-play deck, write the audit entry. Any failure
 * undoes all of it.
 */
import { AppError } from "../../../kernel/AppError.js";

const GRANT_KIND = "starter";

/** @param {string} userId */
export const starterGrantKey = (userId) => `${GRANT_KIND}:${userId}`;

export class StarterService {
  #offer;
  #inventory;
  #decks;
  #audit;
  #unitOfWork;

  /**
   * @param {{
   *   offer: import("../domain/StarterOffer.js").StarterOffer,
   *   inventory: import("../../collection/index.js").InventoryService,
   *   decks: import("../../decks/index.js").DeckService,
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   * }} deps
   */
  constructor({ offer, inventory, decks, audit, unitOfWork }) {
    this.#offer = offer;
    this.#inventory = inventory;
    this.#decks = decks;
    this.#audit = audit;
    this.#unitOfWork = unitOfWork;
  }

  /**
   * @param {string} userId
   */
  async status(userId) {
    const claimed = await this.#inventory.hasGrant(starterGrantKey(userId));
    return Object.freeze({
      claimed,
      choices: Object.freeze(
        this.#offer.choices.map((deck) =>
          Object.freeze({ id: deck.id, name: deck.name, faction: deck.faction, size: deck.totalCards, cards: deck.entries }),
        ),
      ),
    });
  }

  /**
   * @param {{ userId: string, starterId: unknown, ip: string }} input
   */
  async claim({ userId, starterId, ip }) {
    const starter = this.#offer.choices.find((deck) => deck.id === starterId);
    if (starter === undefined) {
      throw new AppError("UNKNOWN_STARTER", "choose one of the offered starter decks");
    }
    return this.#unitOfWork(async () => {
      const key = starterGrantKey(userId);
      const grant = await this.#inventory.grantOnce({
        key,
        kind: GRANT_KIND,
        ownerId: userId,
        items: starter.entries.map((entry) => ({ definitionId: entry.cardId, count: entry.count })),
        edition: this.#offer.edition,
      });
      if (!grant.granted) {
        throw new AppError("STARTER_ALREADY_CLAIMED", "you already received your starter deck");
      }
      const deck = await this.#decks.create(userId, { name: starter.name, faction: starter.faction, cards: starter.entries });
      await this.#audit.record({ actorKind: "user", actorUserId: userId, action: "collection.starter_claimed", targetKind: "grant", targetId: key, ip, details: { starter: starter.id, cards: grant.instances.length, deck: deck.id } });
      return Object.freeze({ deck, cardsGranted: grant.instances.length });
    });
  }
}
