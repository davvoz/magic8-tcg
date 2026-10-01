/**
 * Announced maintenance: when it starts and the line the banner shows. The
 * operator announces it on the server (deploy/maintenance.sh writes
 * /maintenance.json, which nginx serves); no deploy, no restart.
 */

const MAX_MESSAGE_LENGTH = 200;
/** A notice older than this is left over (the deploy did not remove it): no banner. */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/** @typedef {Readonly<{ startsAt: number, message: string | null }>} MaintenanceNotice */

/**
 * @param {unknown} value the parsed maintenance.json: { at: ISO time, message?: string }
 * @returns {MaintenanceNotice | null} null when the value is not a notice
 */
export function parseMaintenanceNotice(value) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { at, message } = /** @type {{ at?: unknown, message?: unknown }} */ (value);
  const startsAt = typeof at === "string" ? Date.parse(at) : Number.NaN;
  if (!Number.isFinite(startsAt)) {
    return null;
  }
  const text = typeof message === "string" && message.trim() !== "" ? message.trim().slice(0, MAX_MESSAGE_LENGTH) : null;
  return Object.freeze({ startsAt, message: text });
}

/**
 * @param {MaintenanceNotice} notice
 * @param {number} now epoch milliseconds
 * @returns {string | null} the banner line, or null when the notice is stale
 */
export function describeMaintenance(notice, now) {
  const left = notice.startsAt - now;
  if (-left > STALE_AFTER_MS) {
    return null;
  }
  const lead = left > 0
    ? `Maintenance in ${formatCountdown(left)}: the game will be back a few minutes later. Please do not buy packs now.`
    : "Maintenance in progress: the game will be back in a few minutes.";
  return notice.message === null ? lead : `${lead} ${notice.message}`;
}

/**
 * @param {number} milliseconds > 0
 * @returns {string} "45s", "11m 32s", or "1h 05m" from one hour up (never mistaken for a clock time)
 */
export function formatCountdown(milliseconds) {
  const total = Math.ceil(milliseconds / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}
