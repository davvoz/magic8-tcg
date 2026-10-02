import { parseMaintenanceNotice } from "../../application/maintenance/MaintenanceNotice.js";

export const SERVER_STATUS_URL = "/api/maintenance";
const BUILD_PATTERN = /^[0-9A-Za-z._-]{1,64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]{1,32})?$/;

/**
 * Reads what the server says about itself: the announced maintenance and
 * the release it serves (version and build). A failure (server down, network
 * error, unexpected answer) means "nothing new": the banner never blocks the game.
 * @param {(url: string, init: RequestInit) => Promise<Response>} httpFetch
 * @returns {Promise<import("../../application/maintenance/MaintenanceWatch.js").ServerStatus | null>}
 */
export async function fetchServerStatus(httpFetch) {
  try {
    const response = await httpFetch(SERVER_STATUS_URL, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const body = await response.json();
    if (typeof body !== "object" || body === null) {
      return null;
    }
    const build = typeof body.build === "string" && BUILD_PATTERN.test(body.build) ? body.build : null;
    const version = typeof body.version === "string" && VERSION_PATTERN.test(body.version) ? body.version : null;
    return Object.freeze({ notice: parseMaintenanceNotice(body.maintenance ?? null), version, build });
  } catch {
    return null;
  }
}
