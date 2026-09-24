/**
 * Logger that records entries so tests can assert on diagnostics.
 * @implements {import("../../application/ports/Logger.contract.js").Logger}
 */
export class MemoryLogger {
  /** @type {{ level: string, message: string, data: unknown }[]} */
  entries = [];

  /** @param {string} message @param {unknown} [data] */
  info(message, data) {
    this.entries.push({ level: "info", message, data });
  }

  /** @param {string} message @param {unknown} [data] */
  warn(message, data) {
    this.entries.push({ level: "warn", message, data });
  }

  /** @param {string} message @param {unknown} [data] */
  error(message, data) {
    this.entries.push({ level: "error", message, data });
  }
}
