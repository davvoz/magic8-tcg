import { COMMAND_TYPES } from "./CommandType.js";

/** Maps command types to handlers. Registration errors are programmer errors and throw. */
export class CommandRegistry {
  /** @type {Map<string, import("./CommandHandler.contract.js").CommandHandler>} */
  #handlers = new Map();

  /**
   * @param {import("./CommandHandler.contract.js").CommandHandler} handler
   * @returns {this}
   */
  register(handler) {
    if (!COMMAND_TYPES.includes(handler?.type)) {
      throw new TypeError(`CommandRegistry: unknown command type "${handler?.type}"`);
    }
    if (typeof handler.validate !== "function" || typeof handler.execute !== "function" || typeof handler.requiresPriority !== "boolean") {
      throw new TypeError(`CommandRegistry: handler for "${handler.type}" does not implement the contract`);
    }
    if (this.#handlers.has(handler.type)) {
      throw new Error(`CommandRegistry: "${handler.type}" is already registered`);
    }
    this.#handlers.set(handler.type, handler);
    return this;
  }

  /** @param {string} type */
  get(type) {
    return this.#handlers.get(type);
  }

  /** @param {string} type */
  has(type) {
    return this.#handlers.has(type);
  }
}
