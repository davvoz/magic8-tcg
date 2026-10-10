/**
 * Auto module: the auto list of ranked play (docs/tcg/23-automatica.md),
 * where the AI plays each player's deck in their style. Other modules use
 * only what is exported here.
 */
export { AutoService } from "./application/AutoService.js";
export { AUTO_STYLES, AutoCloseReason, AutoTicketStatus } from "./domain/AutoTicket.js";
export { registerAutoRoutes } from "./http/autoRoutes.js";
export { PgAutoRepository } from "./infrastructure/PgAutoRepository.js";
export { registerAutoMessages } from "./ws/autoMessages.js";
