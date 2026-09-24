/**
 * Marketplace module (MarketplaceService): products, drop tables, orders,
 * fulfilment. Other modules use only what is exported here.
 */
export { buildMarketCatalog } from "./domain/MarketCatalog.js";
export { ContentType, MAX_CARDS_PER_ORDER, expandProduct } from "./domain/Product.js";
export { OrderStatus } from "./domain/Order.js";
