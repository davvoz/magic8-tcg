/**
 * Ports of the collection module.
 *
 * @typedef {object} InventoryRepository
 * @property {(definitionId: string, edition: string, count: number) => Promise<number>} reserveSerials
 *   atomically reserves `count` consecutive serials for a printing and returns the first
 * @property {(instances: readonly import("../domain/CardInstance.js").CardInstance[]) => Promise<void>} insertMinted
 *   inserts the copies and their MINTED history entries
 * @property {(grant: { key: string, userId: string, kind: string, at: number }) => Promise<boolean>} insertGrant
 *   false when a grant with that key already exists (nothing is written)
 * @property {(key: string) => Promise<boolean>} hasGrant
 * @property {(userId: string) => Promise<readonly import("../domain/CardInstance.js").CardInstance[]>} listOwned copies not burned, by definition then serial
 * @property {(userId: string) => Promise<ReadonlyMap<string, number>>} activeCounts definition → active copies
 * @property {(userId: string, instanceId: string) => Promise<import("../domain/CardInstance.js").CardInstance | null>} findOwned
 * @property {(instanceId: string) => Promise<readonly import("../domain/CardInstance.js").InstanceEvent[]>} history oldest first
 * @property {(ownerId: string, origins: readonly { kind: string, ref: string }[]) => Promise<readonly import("../domain/CardInstance.js").CardInstance[]>} listByOrigins
 *   copies minted for those origins (e.g. an order and its packs), by definition then serial
 * @property {(ids: readonly string[]) => Promise<readonly import("../domain/CardInstance.js").CardInstance[]>} lockInstances
 *   locks the rows of these copies until the unit of work ends, in id order
 * @property {(ownerId: string, definitionId: string, count: number, origins: readonly string[]) => Promise<readonly import("../domain/CardInstance.js").CardInstance[]>} lockTradeable
 *   up to `count` active copies of a card the owner may trade (highest serials first), locked
 * @property {(change: { ids: readonly string[], status: string, ownerId: string | null }) => Promise<void>} updateCopies
 * @property {(events: readonly { instanceId: string, kind: string, fromUserId: string | null, toUserId: string | null, ref: string, at: number }[]) => Promise<void>} insertEvents
 */

export const INVENTORY_REPOSITORY_METHODS = Object.freeze(["reserveSerials", "insertMinted", "insertGrant", "hasGrant", "listOwned", "activeCounts", "findOwned", "history", "listByOrigins", "lockInstances", "lockTradeable", "updateCopies", "insertEvents"]);
