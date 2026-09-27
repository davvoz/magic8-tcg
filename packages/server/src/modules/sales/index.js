/**
 * Sales module (SalesService, SaleSettlement): players sell copies to each
 * other from a public board, for a payment made directly between them on
 * chain. Other modules use only what is exported here.
 */
export { BoardRelay, SALES_CHANNEL } from "./application/BoardRelay.js";
export { DEFAULT_SALES_POLICY, SalesService } from "./application/SalesService.js";
export { SaleSettlement } from "./application/SaleSettlement.js";
export { BoardSort, ListingStatus, PurchaseStatus, SaleProblem } from "./domain/Listing.js";
export { PgSalesRepository } from "./infrastructure/PgSalesRepository.js";
export { registerSalesRoutes } from "./http/salesRoutes.js";
