/**
 * Trading module (TradeService): card-for-card trades between players with
 * escrow, published on chain. Other modules use only what is exported here.
 */
export { DEFAULT_TRADE_POLICY, TradeService } from "./application/TradeService.js";
export { TradeStatus } from "./domain/Trade.js";
export { PgTradeRepository } from "./infrastructure/PgTradeRepository.js";
export { registerTradeRoutes } from "./http/tradeRoutes.js";
