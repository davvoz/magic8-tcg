/**
 * Maintenance module: an announced maintenance closes new payments and games
 * until a deploy (or an operator) ends it. Other modules use only what is
 * exported here; the services it closes only see a gate ({ assertOpen, isClosed }).
 */
export { ALWAYS_OPEN, MAINTENANCE_CHANNEL, MAX_LEAD_MINUTES, MaintenanceService } from "./application/MaintenanceService.js";
export { PgMaintenanceRepository } from "./infrastructure/PgMaintenanceRepository.js";
export { registerMaintenanceRoutes } from "./http/maintenanceRoutes.js";
