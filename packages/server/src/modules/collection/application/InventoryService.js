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
 * - escrow / release / transfer: what a trade does to copies
 *   (docs/tcg/13-scambi.md), inside the trade's unit of work. Only copies
 *   bought (orders, packs) can be traded: free grants would let anyone farm
 *   starter decks on throwaway accounts and funnel them to one.
 */
import { AppError } from "../../../kernel/AppError.js";
import { assertImplements } from "../../../kernel/contracts.js";
import { isUuid, uuidV4 } from "../../../kernel/random.js";
import { InstanceEventKind, InstanceStatus, OriginKind, checkMintRequest } from "../domain/CardInstance.js";
import { INVENTORY_REPOSITORY_METHODS } from "./ports.js";

/**
 * @typedef {Readonly<{ definitionId: string, copies: readonly Readonly<{ id: string, edition: string, serial: number, finish: string, status: string, tradeable: boolean }>[] }>} CollectionEntry
 */

/** Where a copy must come from to be traded. */
export const TRADEABLE_ORIGINS = Object.freeze([OriginKind.PURCHASE, OriginKind.PACK]);

/** @param {import("../domain/CardInstance.js").CardInstance} instance */
const isTradeable = (instance) => TRADEABLE_ORIGINS.includes(/** @type {any} */ (instance.originKind));

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

  /**
   * What was minted for these origins (an order, its packs), still owned by `ownerId`.
   * @param {string} ownerId
   * @param {readonly { kind: string, ref: string }[]} origins
   */
  mintedFor(ownerId, origins) {
    return origins.length === 0 ? Promise.resolve(Object.freeze([])) : this.#repository.listByOrigins(ownerId, origins);
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
      copies.push(Object.freeze({ id: instance.id, edition: instance.edition, serial: instance.serial, finish: instance.finish, status: instance.status, tradeable: isTradeable(instance) }));
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
   * Puts the owner's copies in escrow for a trade: they must be theirs, active and tradeable; they become locked (no deck, no other trade).
   * Runs inside the caller's unit of work.
   * @param {{ ownerId: string, instanceIds: readonly string[], ref: string }} escrow
   * @returns {Promise<readonly import("../domain/CardInstance.js").CardInstance[]>}
   */
  async escrow({ ownerId, instanceIds, ref }) {
    const copies = await this.#repository.lockInstances(instanceIds);
    const problem = instanceIds.find((id) => {
      const copy = copies.find((candidate) => candidate.id === id);
      return copy === undefined || copy.ownerId !== ownerId || copy.status !== InstanceStatus.ACTIVE || !isTradeable(copy);
    });
    if (problem !== undefined) {
      throw new AppError("CONFLICT", `card ${problem} is not one of your tradeable copies (bought, not in another trade)`);
    }
    await this.#change(copies, { status: InstanceStatus.LOCKED, ownerId: null, kind: InstanceEventKind.LOCKED, ref });
    return copies;
  }

  /**
   * Gives escrowed copies back to their owner (trade declined, cancelled, expired).
   * @param {{ instanceIds: readonly string[], ref: string }} release
   */
  async release({ instanceIds, ref }) {
    const copies = (await this.#repository.lockInstances(instanceIds)).filter((copy) => copy.status === InstanceStatus.LOCKED);
    await this.#change(copies, { status: InstanceStatus.ACTIVE, ownerId: null, kind: InstanceEventKind.UNLOCKED, ref });
  }

  /**
   * Up to `count` tradeable copies of each wanted card from the owner, locked for the rest of the unit of work; fails when there are not enough.
   * @param {{ ownerId: string, wants: readonly { definitionId: string, count: number }[] }} request
   */
  async pickTradeable({ ownerId, wants }) {
    const picked = [];
    for (const { definitionId, count } of wants) {
      const copies = await this.#repository.lockTradeable(ownerId, definitionId, count, TRADEABLE_ORIGINS);
      if (copies.length < count) {
        throw new AppError("CONFLICT", `you have ${copies.length} tradeable ${definitionId}, the offer asks for ${count}`);
      }
      picked.push(...copies);
    }
    return Object.freeze(picked);
  }

  /**
   * Hands copies over (the other side of an accepted trade): they must belong to `fromId` (active, or in escrow for this trade).
   * @param {{ fromId: string, toId: string, instanceIds: readonly string[], ref: string }} transfer
   */
  async transfer({ fromId, toId, instanceIds, ref }) {
    const copies = await this.#repository.lockInstances(instanceIds);
    if (copies.length !== instanceIds.length || copies.some((copy) => copy.ownerId !== fromId || copy.status === InstanceStatus.BURNED)) {
      throw new AppError("CONFLICT", "a copy of the trade changed hands in the meantime");
    }
    await this.#change(copies, { status: InstanceStatus.ACTIVE, ownerId: toId, kind: InstanceEventKind.TRANSFERRED, ref, fromId, toId });
    return copies;
  }

  /**
   * @param {readonly import("../domain/CardInstance.js").CardInstance[]} copies
   * @param {{ status: string, ownerId: string | null, kind: string, ref: string, fromId?: string, toId?: string }} change
   */
  async #change(copies, { status, ownerId, kind, ref, fromId, toId }) {
    if (copies.length === 0) {
      return;
    }
    const at = this.#clock.now();
    const ids = copies.map((copy) => copy.id);
    await this.#repository.updateCopies({ ids, status, ownerId });
    await this.#repository.insertEvents(copies.map((copy) => ({ instanceId: copy.id, kind, fromUserId: fromId ?? copy.ownerId, toUserId: toId ?? copy.ownerId, ref, at })));
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
