/**
 * RealtimeConnection over the browser's WebSocket. The browser sends the
 * session cookie and the Origin itself (same origin); nothing secret is
 * handled here. After an unexpected drop it reconnects with growing delays;
 * it does not when the server replaced (4000) or ended (4001) the session.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { RealtimeFailure } from "../../application/ports/Realtime.contract.js";

const NO_RECONNECT = Object.freeze([4000, 4001]);
const BACKOFF_MS = Object.freeze([500, 1000, 2000, 5000, 10_000]);
const REQUEST_TIMEOUT_MS = 10_000;

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
  /** @type {SocketLike | null} */
  #socket = null;
  #wanted = false;
  #attempt = 0;
  #nextId = 0;
  /** @type {Map<string, (result: any) => void>} */
  #pending = new Map();
  /** @type {Set<(message: any) => void>} */
  #listeners = new Set();
  /** @type {Set<(status: ConnectionStatus, detail: { code: number | null }) => void>} */
  #statusListeners = new Set();

  /**
   * @param {{ url: string, createSocket: (url: string) => SocketLike, timers: { setTimeout: (fn: () => void, ms: number) => any, clearTimeout: (handle: any) => void } }} deps
   */
  constructor({ url, createSocket, timers }) {
    this.#url = url;
    this.#createSocket = createSocket;
    this.#timers = timers;
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
    this.#socket?.close();
    this.#socket = null;
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
    socket.onopen = () => {
      this.#attempt = 0;
      this.#emitStatus("open", null);
    };
    socket.onmessage = (event) => this.#receive(event.data);
    socket.onerror = () => undefined;
    socket.onclose = (event) => {
      if (this.#socket !== socket) {
        return;
      }
      this.#socket = null;
      for (const resolve of this.#pending.values()) {
        resolve({ t: "error", d: { code: RealtimeFailure.NOT_CONNECTED, message: "connection lost" } });
      }
      this.#pending.clear();
      const code = typeof event?.code === "number" ? event.code : null;
      this.#emitStatus("closed", code);
      if (this.#wanted && !NO_RECONNECT.includes(/** @type {number} */ (code))) {
        const delay = BACKOFF_MS[Math.min(this.#attempt, BACKOFF_MS.length - 1)];
        this.#attempt += 1;
        this.#timers.setTimeout(() => {
          if (this.#wanted && this.#socket === null) {
            this.#open();
          }
        }, delay);
      }
    };
  }

  /** @param {unknown} data */
  #receive(data) {
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
