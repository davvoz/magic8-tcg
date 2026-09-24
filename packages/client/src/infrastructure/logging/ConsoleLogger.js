/**
 * Logger port over the console. This is the one module in src/ allowed to
 * use `console` (see eslint.config.js); everything else logs through the
 * Logger port so diagnostics can be redirected or silenced.
 */

/** @implements {import("../../application/ports/Logger.contract.js").Logger} */
export class ConsoleLogger {
  #prefix;

  /** @param {string} [prefix] */
  constructor(prefix = "[magic8]") {
    this.#prefix = prefix;
  }

  /** @param {string} message @param {unknown} [data] */
  info(message, data) {
    console.info(this.#prefix, message, data ?? "");
  }

  /** @param {string} message @param {unknown} [data] */
  warn(message, data) {
    console.warn(this.#prefix, message, data ?? "");
  }

  /** @param {string} message @param {unknown} [data] */
  error(message, data) {
    console.error(this.#prefix, message, data ?? "");
  }
}
