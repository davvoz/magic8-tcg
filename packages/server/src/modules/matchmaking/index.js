/**
 * Matchmaking module: the queue for online games and pairing.
 * Other modules use only what is exported here.
 */
export { MatchmakingService, QueueMode, TicketStatus } from "./application/MatchmakingService.js";
export { PgMatchmakingRepository } from "./infrastructure/PgMatchmakingRepository.js";
