/**
 * RealtimeConnection over the browser's WebSocket. The browser sends the
 * session cookie and the Origin itself (same origin); nothing secret is
 * handled here. After an unexpected drop it reconnects with growing delays;
 * it does not when the server replaced (4000) or ended (4001) the session.
 *
 * The browser does not always notice a dead connection: an attempt to
 * connect can hang for minutes, and a socket whose peer is gone can look
 * open for as long. So an attempt not open within CONNECT_TIMEOUT_MS is
 * given up and retried, and an open socket is pinged every HEARTBEAT_MS: a
 * ping without an answer within PONG_TIMEOUT_MS drops it and reconnects.
 * `wake` (the page is back online or on screen) retries a lost connection
 * at once instead of at its next delay, and checks an open one.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { RealtimeFailure } from "../../application/ports/Realtime.contract.js";

const NO_RECONNECT = Object.freeze([4000, 4001]);
const BACKOFF_MS = Object.freeze([500, 1000, 2000, 5000, 10_000]);
const REQUEST_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 15_000;
const PONG_TIMEOUT_MS = 10_000;

/**
 * @typedef {{ send: (data: string) => void, close: () => void, readyState: number, onopen: any, onclose: any, onmessage: any, onerror: any }} SocketLike
 */

/** @typedef {import("../../application/ports/Realtime.contract.js").RealtimeConnection} RealtimeConnection */
/** @typedef {import("../../application/ports/Realtime.contract.js").ConnectionStatus} ConnectionStatus */

/** @implements {RealtimeConnection} */
export class WebSocketConnection {
  #url;
  #createSocket;
  #timers;
  #now;
  #logger;
  /** @type {SocketLike | null} */
  #socket = null;
  #wanted = false;
  #attempt = 0;
  /** The pending reconnection, if one is scheduled. @type {any} */
  #retry = null;
  /** When the unanswered ping went out; null when none is. @type {number | null} */
  #pingSentAt = null;
  #nextId = 0;
  /** @type {Map<string, (result: any) => void>} */
  #pending = new Map();
  /** @type {Set<(message: any) => void>} */
  #listeners = new Set();
  /** @type {Set<(status: ConnectionStatus, detail: { code: number | null }) => void>} */
  #statusListeners = new Set();

  /**
   * @param {{
   *   url: string,
   *   createSocket: (url: string) => SocketLike,
   *   timers: { setTimeout: (fn: () => void, ms: number) => any, clearTimeout: (handle: any) => void },
   *   now?: () => number,
   *   logger?: Pick<import("../../application/ports/Logger.contract.js").Logger, "warn">,
   * }} deps
   */
  constructor({ url, createSocket, timers, now = () => Date.now(), logger }) {
    this.#url = url;
    this.#createSocket = createSocket;
    this.#timers = timers;
    this.#now = now;
    this.#logger = logger ?? null;
  }

  /** @returns {"connecting" | "open" | "closed"} */
  get status() {
    if (this.#socket === null) {
      return "closed";
    }
    return this.#socket.readyState === 1 ? "open" : "connecting";
  }

  connect() {
    this.#wanted = true;
    if (this.#socket === null) {
      this.#open();
    }
  }

  close() {
    this.#wanted = false;
    this.#cancelRetry();
    this.#socket?.close();
    this.#socket = null;
  }

  /**
   * The page is back (online again, on screen again): a reconnection waiting
   * for its delay goes now, an open connection is checked now.
   */
  wake() {
    if (!this.#wanted) {
      return;
    }
    if (this.#socket === null && this.#retry !== null) {
      this.#cancelRetry();
      this.#attempt = 0;
      this.#open();
    } else if (this.#socket !== null && this.#socket.readyState === 1) {
      this.#ping(this.#socket);
    }
  }

  /** Drops the current connection and makes a new one (the server stopped answering on it). */
  reconnect() {
    const socket = this.#socket;
    if (socket !== null) {
      this.#giveUp(socket, "the game server stopped answering");
    }
  }

  /**
   * @param {string} type
   * @param {unknown} data
   */
  request(type, data) {
    const socket = this.#socket;
    if (socket === null || socket.readyState !== 1) {
      return Promise.resolve(fail(RealtimeFailure.NOT_CONNECTED, "not connected to the game server"));
    }
    this.#nextId += 1;
    const id = `c${this.#nextId}`;
    return new Promise((resolve) => {
      const timer = this.#timers.setTimeout(() => {
        this.#pending.delete(id);
        resolve(fail(RealtimeFailure.TIMEOUT, "the game server did not answer"));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, (message) => {
        this.#timers.clearTimeout(timer);
        resolve(ok(message));
      });
      socket.send(JSON.stringify({ t: type, id, d: data }));
    });
  }

  /** @param {(message: any) => void} listener */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** @param {(status: ConnectionStatus, detail: { code: number | null }) => void} listener */
  onStatus(listener) {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  #open() {
    this.#emitStatus("connecting", null);
    const socket = this.#createSocket(this.#url);
    this.#socket = socket;
    this.#pingSentAt = null;
    socket.onopen = () => {
      if (this.#socket !== socket) {
        return;
      }
      this.#attempt = 0;
      this.#emitStatus("open", null);
      this.#heartbeat(socket);
    };
    socket.onmessage = (event) => {
      if (this.#socket === socket) {
        this.#receive(event.data);
      }
    };
    socket.onerror = () => undefined;
    socket.onclose = (event) => this.#closed(socket, typeof event?.code === "number" ? event.code : null);
    this.#timers.setTimeout(() => {
      if (this.#socket === socket && socket.readyState !== 1) {
        this.#giveUp(socket, "the game server could not be reached in time");
      }
    }, CONNECT_TIMEOUT_MS);
  }

  /**
   * Pings the server every HEARTBEAT_MS while this socket is the current, open one.
   * @param {SocketLike} socket
   */
  #heartbeat(socket) {
    this.#timers.setTimeout(() => {
      if (this.#socket === socket && socket.readyState === 1) {
        this.#ping(socket);
        this.#heartbeat(socket);
      }
    }, HEARTBEAT_MS);
  }

  /**
   * Sends a ping, unless one is already waiting for its answer; any message
   * from the server counts as the answer.
   * @param {SocketLike} socket
   */
  #ping(socket) {
    if (this.#pingSentAt !== null) {
      return;
    }
    const sentAt = this.#now();
    this.#pingSentAt = sentAt;
    socket.send(JSON.stringify({ t: "ping", d: {} }));
    this.#timers.setTimeout(() => {
      if (this.#socket === socket && this.#pingSentAt === sentAt) {
        this.#giveUp(socket, "the game server stopped answering");
      }
    }, PONG_TIMEOUT_MS);
  }

  /**
   * Abandons a socket the browser still thinks is alive (or still connecting) and reconnects.
   * @param {SocketLike} socket
   * @param {string} why
   */
  #giveUp(socket, why) {
    this.#logger?.warn(`realtime connection dropped: ${why}`);
    socket.close();
    this.#closed(socket, null);
  }

  /**
   * @param {SocketLike} socket
   * @param {number | null} code
   */
  #closed(socket, code) {
    if (this.#socket !== socket) {
      return;
    }
    this.#socket = null;
    this.#pingSentAt = null;
    for (const resolve of this.#pending.values()) {
      resolve({ t: "error", d: { code: RealtimeFailure.NOT_CONNECTED, message: "connection lost" } });
    }
    this.#pending.clear();
    if (code !== null && code !== 1000) {
      this.#logger?.warn(`realtime connection closed (${code})`);
    }
    this.#emitStatus("closed", code);
    if (this.#wanted && !NO_RECONNECT.includes(/** @type {number} */ (code))) {
      const delay = BACKOFF_MS[Math.min(this.#attempt, BACKOFF_MS.length - 1)];
      this.#attempt += 1;
      this.#retry = this.#timers.setTimeout(() => {
        this.#retry = null;
        if (this.#wanted && this.#socket === null) {
          this.#open();
        }
      }, delay);
    }
  }

  #cancelRetry() {
    if (this.#retry !== null) {
      this.#timers.clearTimeout(this.#retry);
      this.#retry = null;
    }
  }

  /** @param {unknown} data */
  #receive(data) {
    this.#pingSentAt = null;
    let message;
    try {
      message = typeof data === "string" ? JSON.parse(data) : null;
    } catch {
      return;
    }
    if (message === null || typeof message !== "object" || typeof message.t !== "string") {
      return;
    }
    if (typeof message.re === "string") {
      const resolve = this.#pending.get(message.re);
      this.#pending.delete(message.re);
      resolve?.(Object.freeze({ t: message.t, d: message.d }));
      return;
    }
    if (message.t === "pong") {
      return;
    }
    for (const listener of this.#listeners) {
      listener(Object.freeze({ t: message.t, d: message.d }));
    }
  }

  /**
   * @param {ConnectionStatus} status
   * @param {number | null} code
   */
  #emitStatus(status, code) {
    for (const listener of this.#statusListeners) {
      listener(status, { code });
    }
  }
}
