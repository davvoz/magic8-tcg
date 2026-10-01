import { parseMaintenanceNotice } from "../../application/maintenance/MaintenanceNotice.js";

export const MAINTENANCE_NOTICE_URL = "/maintenance.json";

/**
 * Reads the maintenance notice. No file (404), a network error or a malformed
 * file all mean "no maintenance announced": the banner never blocks the game.
 * @param {(url: string, init: RequestInit) => Promise<Response>} httpFetch
 * @returns {Promise<import("../../application/maintenance/MaintenanceNotice.js").MaintenanceNotice | null>}
 */
export async function fetchMaintenanceNotice(httpFetch) {
  try {
    const response = await httpFetch(MAINTENANCE_NOTICE_URL, { cache: "no-store" });
    return response.ok ? parseMaintenanceNotice(await response.json()) : null;
  } catch {
    return null;
  }
}
