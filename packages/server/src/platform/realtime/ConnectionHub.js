/**
 * Who is connected right now, and the one way to push a message to a user.
 * A user has at most one live connection: a new one replaces the previous
 * (docs/tcg/02-protocollo-multiplayer.md §3.1). Modules send through this
 * hub (their GameNotifier port) and never see sockets.
 *
 * @typedef {{ send: (message: string) => void, close: (code: number, reason: string) => void }} Connection
 */

export class ConnectionHub {
  /** @type {Map<string, Connection>} */
  #connections = new Map();
  #logger;

  /** @param {{ logger: import("../../kernel/logger.js").Logger }} deps */
  constructor({ logger }) {
    this.#logger = logger;
  }

  /**
   * @param {string} userId
   * @param {Connection} connection
   * @returns {Connection | null} the connection it replaced
   */
  attach(userId, connection) {
    const previous = this.#connections.get(userId) ?? null;
    this.#connections.set(userId, connection);
    return previous;
  }

  /**
   * Forgets the connection if it is still the user's current one.
   * @param {string} userId
   * @param {Connection} connection
   * @returns {boolean} whether the user is now disconnected
   */
  detach(userId, connection) {
    if (this.#connections.get(userId) !== connection) {
      return false;
    }
    this.#connections.delete(userId);
    return true;
  }

  /** @param {string} userId */
  isConnected(userId) {
    return this.#connections.has(userId);
  }

  /**
   * @param {string} userId
   * @param {string} type
   * @param {unknown} data
   */
  send(userId, type, data) {
    const connection = this.#connections.get(userId);
    if (connection === undefined) {
      return;
    }
    try {
      connection.send(JSON.stringify({ t: type, d: data }));
    } catch (error) {
      this.#logger.warn("could not deliver a message", { user: userId, type, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
