/**
 * Catalog module: the validated, hash-identified game content.
 * Other modules use only what is exported here.
 */
export { CatalogService, ContentInvalidError } from "./application/CatalogService.js";
export { PgContentRepository } from "./infrastructure/PgContentRepository.js";
export { readContentDirectory } from "./infrastructure/readContentDirectory.js";
export { registerCatalogRoutes } from "./http/catalogRoutes.js";
