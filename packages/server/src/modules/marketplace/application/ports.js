/**
 * Ports of the marketplace module.
 *
 * @typedef {import("../domain/Order.js").Order} Order
 * @typedef {Readonly<{ id: number, commit: string, sealedSecret: Uint8Array, openedAt: number, closedAt: number | null, revealedAt: number | null }>} StoredEpoch
 *
 * @typedef {object} MarketplaceRepository
 * @property {(products: readonly import("../domain/Product.js").Product[], at: number) => Promise<void>} syncProducts
 *   mirrors the product data into products/product_prices/product_items (order items reference them); products no longer in the data become inactive
 * @property {(order: Order) => Promise<boolean>} insertOrder orders + order_items; false (nothing written) when the user already has an order with that idempotency key
 * @property {(id: string) => Promise<Order | null>} findOrder
 * @property {(userId: string, key: string) => Promise<Order | null>} findByIdempotencyKey
 * @property {(memo: string) => Promise<Order | null>} findByMemo
 * @property {(userId: string, limit: number) => Promise<readonly Order[]>} listForUser newest first
 * @property {(userId: string) => Promise<number>} countOpen orders not yet settled
 * @property {(id: string, from: string, to: string, changes: { at: number, paymentId?: string | null, failureReason?: string | null }) => Promise<Order | null>} transition
 *   compare-and-set: null when the order was not in `from`
 * @property {(before: number, limit: number) => Promise<readonly string[]>} listExpirable ids of orders awaiting payment whose expiry is before `before`
 * @property {(status: string, limit: number) => Promise<readonly string[]>} listByStatus ids, oldest update first
 * @property {() => Promise<void>} lockEpochs serialises epoch rollover (transaction-scoped)
 * @property {() => Promise<StoredEpoch | null>} openEpoch the epoch taking orders
 * @property {() => Promise<number>} nextEpochId under lockEpochs
 * @property {(epoch: { id: number, commit: string, sealedSecret: Uint8Array, openedAt: number }) => Promise<void>} insertEpoch
 * @property {(id: number) => Promise<StoredEpoch | null>} findEpoch
 * @property {(id: number, at: number) => Promise<void>} closeEpoch
 * @property {(id: number, at: number) => Promise<boolean>} markEpochRevealed false when it was already revealed
 * @property {() => Promise<readonly StoredEpoch[]>} listEpochs newest first
 * @property {(limit: number) => Promise<readonly StoredEpoch[]>} listUnrevealedClosed
 * @property {(epochId: number) => Promise<number>} countOpenForEpoch
 *
 * @typedef {object} EpochPublisher sends pack epoch payloads (canonical JSON) to the chain outbox, inside the caller's unit of work
 * @property {(payload: string) => Promise<void>} publishEpoch
 */

export const MARKETPLACE_REPOSITORY_METHODS = Object.freeze([
  "syncProducts",
  "insertOrder",
  "findOrder",
  "findByIdempotencyKey",
  "findByMemo",
  "listForUser",
  "countOpen",
  "transition",
  "listExpirable",
  "listByStatus",
  "lockEpochs",
  "openEpoch",
  "nextEpochId",
  "insertEpoch",
  "findEpoch",
  "closeEpoch",
  "markEpochRevealed",
  "listEpochs",
  "listUnrevealedClosed",
  "countOpenForEpoch",
]);
