/**
 * Announced maintenance: when it starts and the line the banner shows. Every
 * deploy announces one (deploy/deploy.sh); an operator can too, from the
 * admin page or deploy/maintenance.sh. The banner also says when the
 * connection to the server is lost and when a newer version is live.
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
    ? `Maintenance in ${formatCountdown(left)}: the shop and new games are paused.`
    : "Maintenance in progress: back in a few minutes.";
  return notice.message === null ? lead : `${lead} ${notice.message}`;
}

/** A connection lost for less than this is not worth a banner (it comes straight back). */
export const DISCONNECTED_AFTER_MS = 3000;

/**
 * What the banner says, most urgent first: the maintenance, a lost
 * connection, then a newer version (with a reload button).
 * @param {Readonly<{ notice: MaintenanceNotice | null, disconnectedSince: number | null, updateAvailable: boolean }>} state
 * @param {number} now epoch milliseconds
 * @returns {Readonly<{ text: string, reload: boolean }> | null} null: no banner
 */
export function describeBanner({ notice, disconnectedSince, updateAvailable }, now) {
  const maintenance = notice === null ? null : describeMaintenance(notice, now);
  if (maintenance !== null) {
    return Object.freeze({ text: maintenance, reload: false });
  }
  if (disconnectedSince !== null && now - disconnectedSince >= DISCONNECTED_AFTER_MS) {
    return Object.freeze({ text: "Connection to the game server lost: reconnecting…", reload: false });
  }
  return updateAvailable ? Object.freeze({ text: "A new version of the game is out.", reload: true }) : null;
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
