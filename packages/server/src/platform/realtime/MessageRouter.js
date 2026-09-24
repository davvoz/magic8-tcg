/**
 * Routes WebSocket messages by type, like the HTTP Router does by path.
 * A handler receives the authenticated principal and the payload, and
 * returns the reply ({ t, d }) or null for none; an AppError becomes an
 * `error` reply with its code. Handlers are registered by the modules.
 *
 * @typedef {Readonly<{ principal: any, ip: string }>} MessageContext
 * @typedef {(context: MessageContext, data: Record<string, unknown>) => Promise<Readonly<{ t: string, d: unknown }> | null>} MessageHandler
 */

export class MessageRouter {
  /** @type {Map<string, MessageHandler>} */
  #handlers = new Map();

  /**
   * @param {string} type
   * @param {MessageHandler} handler
   */
  on(type, handler) {
    if (this.#handlers.has(type)) {
      throw new Error(`MessageRouter: "${type}" is already handled`);
    }
    this.#handlers.set(type, handler);
    return this;
  }

  /** @param {string} type */
  handlerFor(type) {
    return this.#handlers.get(type) ?? null;
  }
}
