/**
 * InventoryService: the only way copies of cards come into existence, and
 * the read side of what a player owns (docs/tcg/01-architettura.md §7.1).
 *
 * - mint: validates the request against the catalog, reserves serials,
 *   inserts the copies and their history. Called only by other use cases
 *   (a free grant here; order fulfilment in M3), inside their unit of work;
 *   no endpoint mints cards.
 * - grantOnce: a free grant (starter deck, promotion) identified by a key;
 *   the key is the primary key of `grants`, so a retry, a double click or a
 *   concurrent request can never grant twice.
 */
import { AppError } from "../../../kernel/AppError.js";
import { assertImplements } from "../../../kernel/contracts.js";
import { isUuid, uuidV4 } from "../../../kernel/random.js";
import { InstanceStatus, OriginKind, checkMintRequest } from "../domain/CardInstance.js";
import { INVENTORY_REPOSITORY_METHODS } from "./ports.js";

/**
 * @typedef {Readonly<{ definitionId: string, copies: readonly Readonly<{ id: string, edition: string, serial: number, finish: string, status: string }>[] }>} CollectionEntry
 */

export class InventoryService {
  #repository;
  #isKnownCard;
  #random;
  #clock;
  #unitOfWork;

  /**
   * @param {{
   *   repository: import("./ports.js").InventoryRepository,
   *   isKnownCard: (definitionId: string) => boolean,
   *   random: import("../../../kernel/random.js").SecureRandom,
   *   clock: import("../../../kernel/time.js").Clock,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   * }} deps
   */
  constructor({ repository, isKnownCard, random, clock, unitOfWork }) {
    assertImplements(repository, INVENTORY_REPOSITORY_METHODS, "InventoryRepository");
    this.#repository = repository;
    this.#isKnownCard = isKnownCard;
    this.#random = random;
    this.#clock = clock;
    this.#unitOfWork = unitOfWork;
  }

  /**
   * @param {{ ownerId: string, items: readonly import("../domain/CardInstance.js").MintItem[], edition: string, finish: string, origin: { kind: string, ref: string } }} request
   * @returns {Promise<readonly import("../domain/CardInstance.js").CardInstance[]>}
   */
  async mint(request) {
    const checked = checkMintRequest(request, this.#isKnownCard);
    if (!checked.ok) {
      // Callers build mint requests from trusted data (catalog, products): a failure here is a bug, not bad input.
      throw new Error(`InventoryService.mint: ${checked.error.message}`);
    }
    return this.#unitOfWork(async () => {
      const now = this.#clock.now();
      /** @type {import("../domain/CardInstance.js").CardInstance[]} */
      const instances = [];
      for (const { definitionId, count } of checked.value) {
        const first = await this.#repository.reserveSerials(definitionId, request.edition, count);
        for (let offset = 0; offset < count; offset += 1) {
          instances.push(
            Object.freeze({
              id: uuidV4(this.#random),
              definitionId,
              edition: request.edition,
              serial: first + offset,
              finish: request.finish,
              ownerId: request.ownerId,
              status: /** @type {const} */ (InstanceStatus.ACTIVE),
              originKind: /** @type {any} */ (request.origin.kind),
              originRef: request.origin.ref,
              mintedAt: now,
            }),
          );
        }
      }
      await this.#repository.insertMinted(instances);
      return Object.freeze(instances);
    });
  }

  /**
   * @param {{ key: string, kind: string, ownerId: string, items: readonly import("../domain/CardInstance.js").MintItem[], edition: string, finish: string }} grant
   * @returns {Promise<Readonly<{ granted: boolean, instances: readonly import("../domain/CardInstance.js").CardInstance[] }>>}
   */
  async grantOnce({ key, kind, ownerId, items, edition, finish }) {
    return this.#unitOfWork(async () => {
      const granted = await this.#repository.insertGrant({ key, userId: ownerId, kind, at: this.#clock.now() });
      if (!granted) {
        return Object.freeze({ granted: false, instances: Object.freeze([]) });
      }
      const instances = await this.mint({ ownerId, items, edition, finish, origin: { kind: OriginKind.GRANT, ref: key } });
      return Object.freeze({ granted: true, instances });
    });
  }

  /** @param {string} key */
  hasGrant(key) {
    return this.#repository.hasGrant(key);
  }

  /**
   * Everything a user owns, grouped by card.
   * @param {string} userId
   * @returns {Promise<readonly CollectionEntry[]>}
   */
  async collection(userId) {
    /** @type {Map<string, CollectionEntry["copies"][number][]>} */
    const groups = new Map();
    for (const instance of await this.#repository.listOwned(userId)) {
      const copies = groups.get(instance.definitionId) ?? [];
      copies.push(Object.freeze({ id: instance.id, edition: instance.edition, serial: instance.serial, finish: instance.finish, status: instance.status }));
      groups.set(instance.definitionId, copies);
    }
    return Object.freeze([...groups].map(([definitionId, copies]) => Object.freeze({ definitionId, copies: Object.freeze(copies) })));
  }

  /**
   * Active copies per card: what a deck may use.
   * @param {string} userId
   * @returns {Promise<ReadonlyMap<string, number>>}
   */
  activeCounts(userId) {
    return this.#repository.activeCounts(userId);
  }

  /**
   * One of the user's own copies with its history. Someone else's copy is
   * reported as not found: ids of other players' cards reveal nothing.
   * @param {string} userId
   * @param {unknown} instanceId
   */
  async card(userId, instanceId) {
    const instance = isUuid(instanceId) ? await this.#repository.findOwned(userId, instanceId) : null;
    if (instance === null) {
      throw new AppError("NOT_FOUND", "no such card in your collection");
    }
    return Object.freeze({ instance, history: await this.#repository.history(instance.id) });
  }
}
