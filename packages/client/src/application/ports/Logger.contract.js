/**
 * Diagnostics port. The domain never logs; the application logs only
 * unexpected situations (invalid stored data, controller failures).
 *
 * @typedef {object} Logger
 * @property {(message: string, data?: unknown) => void} info
 * @property {(message: string, data?: unknown) => void} warn
 * @property {(message: string, data?: unknown) => void} error
 */

export const LOGGER_METHODS = Object.freeze(["info", "warn", "error"]);
