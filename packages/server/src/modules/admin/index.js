/**
 * Admin module: the operators' view and their few actions. Other modules
 * use only what is exported here.
 */
export { AdminService } from "./application/AdminService.js";
export { DEFAULT_ALARM_POLICY, Monitor } from "./application/Monitor.js";
export { registerMonitoringRoutes } from "./http/monitoringRoutes.js";
export { registerAdminRoutes } from "./http/adminRoutes.js";
export { PgOperationsReadModel } from "./infrastructure/PgOperationsReadModel.js";
