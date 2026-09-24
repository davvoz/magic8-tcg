/**
 * Economy module (EconomyService): accepted assets, exact money, prices.
 * Other modules use only what is exported here.
 */
export { EconomyService } from "./application/EconomyService.js";
export { AssetRegistry, validateAssets } from "./domain/AssetRegistry.js";
export { MAX_UNITS, formatAmount, parseAmount, safeMultiply } from "./domain/Money.js";
