import { parseMaintenanceNotice } from "../../application/maintenance/MaintenanceNotice.js";

export const MAINTENANCE_URL = "/api/maintenance";

/**
 * Reads the announced maintenance from the server. A failure (server down,
 * network error, unexpected answer) means "none known": the banner never
 * blocks the game.
 * @param {(url: string, init: RequestInit) => Promise<Response>} httpFetch
 * @returns {Promise<import("../../application/maintenance/MaintenanceNotice.js").MaintenanceNotice | null>}
 */
export async function fetchMaintenanceNotice(httpFetch) {
  try {
    const response = await httpFetch(MAINTENANCE_URL, { cache: "no-store" });
    return response.ok ? parseMaintenanceNotice((await response.json())?.maintenance ?? null) : null;
  } catch {
    return null;
  }
}
