/**
 * Logger that discards everything. Used in tests and headless simulations.
 * @type {import("../../application/ports/Logger.contract.js").Logger}
 */
export const nullLogger = Object.freeze({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});
