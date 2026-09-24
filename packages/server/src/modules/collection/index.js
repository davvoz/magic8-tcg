/**
 * Collection module (InventoryService): owned copies of cards, their
 * serials and history, free grants. Other modules use only what is exported here.
 */
export { InventoryService } from "./application/InventoryService.js";
export { InstanceStatus, OriginKind } from "./domain/CardInstance.js";
export { PgInventoryRepository } from "./infrastructure/PgInventoryRepository.js";
export { registerCollectionRoutes } from "./http/collectionRoutes.js";
