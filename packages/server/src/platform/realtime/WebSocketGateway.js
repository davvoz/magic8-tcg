/**
 * The WebSocket endpoint /ws (docs/tcg/02-protocollo-multiplayer.md §3).
 *
 * Upgrade: only with a valid session cookie AND an allowed Origin. Browsers
 * do not apply CORS to WebSockets, so without the Origin check any site
 * could open a connection with the player's cookies (T14).
 *
 * Connection: one per user (a new one replaces the old, which is told and
 * closed); messages of at most 4 KiB; a token bucket per connection (20/s,
 * burst 40), repeated abuse closes with 4008 (T13); ping every 20 s, no
 * pong for 45 s closes; the session is re-checked every minute, so a
 * revoked or expired session ends its socket too.
 *
 * Messages are envelopes { t, id?, d }; replies carry `re` = the id.
 */
import { WebSocketServer } from "ws";

import { AppError } from "../../kernel/AppError.js";
import { clientAddress } from "../http/clientAddress.js";
import { parseCookies } from "../http/cookies.js";
import { parseJson } from "../../kernel/json.js";

export const CloseCode = Object.freeze({ REPLACED: 4000, UNAUTHENTICATED: 4001, BAD_MESSAGE: 4002, RATE_LIMITED: 4008 });

const PATH = "/ws";
const TYPE_PATTERN = /^[a-z]+(\.[a-z]+)?$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const DEFAULTS = Object.freeze({
  maxMessageBytes: 4096,
  pingIntervalMs: 20_000,
  pongTimeoutMs: 45_000,
  sessionCheckMs: 60_000,
  ratePerSecond: 20,
  rateBurst: 40,
  maxRateViolations: 10,
  maxBadMessages: 10,
  /** Outgoing bytes a client may leave unread before it is dropped (it resynchronises on reconnect). */
  maxBufferedBytes: 512 * 1024,
});
/** Upgrade attempts per address: each one costs a session lookup. */
const UPGRADE_RATE = Object.freeze({ name: "ws-upgrade", capacity: 10, refillPerSecond: 0.5, by: /** @type {const} */ ("ip") });

/**
 * @typedef {typeof DEFAULTS} GatewayPolicy
 */

export class WebSocketGateway {
  #hub;
  #router;
  #authenticate;
  #onPresence;
  #clock;
  #logger;
  #allowedOrigins;
  #cookieName;
  #trustProxy;
  #policy;
  #rateLimiter;
  /** @type {WebSocketServer} */
  #server;
  /** @type {Set<import("ws").WebSocket>} */
  #sockets = new Set();

  /**
   * @param {{
   *   hub: import("./ConnectionHub.js").ConnectionHub,
   *   router: import("./MessageRouter.js").MessageRouter,
   *   authenticate: (token: string | null) => Promise<any>,
   *   onPresence: (userId: string, connected: boolean) => Promise<void>,
   *   clock: import("../../kernel/time.js").Clock,
   *   logger: import("../../kernel/logger.js").Logger,
   *   config: { allowedOrigins: readonly string[], sessionCookieName: string, trustProxy: boolean },
   *   rateLimiter: import("../http/RateLimiter.js").RateLimiter,
   *   policy?: Partial<GatewayPolicy>,
   * }} deps
   */
  constructor({ hub, router, authenticate, onPresence, clock, logger, config, rateLimiter, policy = {} }) {
    this.#hub = hub;
    this.#router = router;
    this.#authenticate = authenticate;
    this.#onPresence = onPresence;
    this.#clock = clock;
    this.#logger = logger;
    this.#allowedOrigins = config.allowedOrigins;
    this.#cookieName = config.sessionCookieName;
    this.#trustProxy = config.trustProxy;
    this.#policy = Object.freeze({ ...DEFAULTS, ...policy });
    this.#rateLimiter = rateLimiter;
    this.#server = new WebSocketServer({ noServer: true, maxPayload: this.#policy.maxMessageBytes, perMessageDeflate: false, clientTracking: false });
  }

  /**
   * Handles upgrade requests of an HTTP server.
   * @param {import("node:http").Server} httpServer
   */
  attach(httpServer) {
    httpServer.on("upgrade", (request, socket, head) => {
      this.#upgrade(request, socket, head).catch((error) => {
        this.#logger.error("websocket upgrade failed", { error: error instanceof Error ? error.message : String(error) });
        reject(socket, 500, "Internal Server Error");
      });
    });
  }

  /** Closes every live connection (shutdown). */
  close() {
    for (const socket of this.#sockets) {
      socket.terminate();
    }
    this.#sockets.clear();
  }

  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:stream").Duplex} socket
   * @param {Buffer} head
   */
  async #upgrade(request, socket, head) {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path !== PATH) {
      reject(socket, 404, "Not Found");
      return;
    }
    const origin = request.headers.origin;
    if (typeof origin !== "string" || !this.#allowedOrigins.includes(origin)) {
      reject(socket, 403, "Forbidden");
      return;
    }
    const ip = this.#clientIp(request);
    if (!this.#rateLimiter.take(UPGRADE_RATE, ip).allowed) {
      reject(socket, 429, "Too Many Requests");
      return;
    }
    const token = parseCookies(request.headers.cookie ?? "").get(this.#cookieName) ?? null;
    const principal = await this.#authenticate(token);
    if (principal === null) {
      reject(socket, 401, "Unauthorized");
      return;
    }
    this.#server.handleUpgrade(request, socket, head, (socketConnection) => this.#connected(socketConnection, principal, token, ip));
  }

  /**
   * @param {import("ws").WebSocket} socket
   * @param {any} principal
   * @param {string | null} token
   * @param {string} ip
   */
  #connected(socket, principal, token, ip) {
    const userId = principal.user.id;
    this.#sockets.add(socket);
    const live = new LiveConnection({ socket, policy: this.#policy, clock: this.#clock });
    const previous = this.#hub.attach(userId, live.connection);
    if (previous !== null) {
      previous.send(JSON.stringify({ t: "session.replaced", d: {} }));
      previous.close(CloseCode.REPLACED, "replaced by a newer connection");
    }
    const presence = (connected) => this.#onPresence(userId, connected).catch((error) => this.#logger.warn("presence update failed", { user: userId, error: error instanceof Error ? error.message : String(error) }));
    const heartbeat = setInterval(() => {
      live.heartbeat(async () => {
        const current = await this.#authenticate(token).catch(() => null);
        return current !== null && current.user.id === userId;
      });
    }, this.#policy.pingIntervalMs);
    heartbeat.unref?.();
    live.onMessage((envelope) => this.#dispatch(live, { principal, ip }, envelope));
    socket.on("close", () => {
      this.#sockets.delete(socket);
      clearInterval(heartbeat);
      if (this.#hub.detach(userId, live.connection)) {
        presence(false);
      }
    });
    socket.on("error", (error) => this.#logger.warn("websocket error", { user: userId, error: error.message }));
    presence(true);
  }

  /**
   * @param {LiveConnection} live
   * @param {import("./MessageRouter.js").MessageContext} context
   * @param {{ t: string, id: string | null, d: Record<string, unknown> }} envelope
   */
  async #dispatch(live, context, envelope) {
    const handler = this.#router.handlerFor(envelope.t);
    if (handler === null) {
      live.reply("error", envelope.id, { code: "UNKNOWN_MESSAGE", message: `unknown message type "${envelope.t}"` });
      return;
    }
    try {
      const answer = await handler(context, envelope.d);
      if (answer !== null) {
        live.reply(answer.t, envelope.id, answer.d);
      }
    } catch (error) {
      if (error instanceof AppError) {
        live.reply("error", envelope.id, { code: error.code, message: error.message, details: error.details });
        return;
      }
      this.#logger.error("websocket handler failed", { type: envelope.t, error: error instanceof Error ? error.message : String(error) });
      live.reply("error", envelope.id, { code: "INTERNAL", message: "something went wrong" });
    }
  }

  /** @param {import("node:http").IncomingMessage} request */
  #clientIp(request) {
    return clientAddress(request, this.#trustProxy);
  }
}

/**
 * One open socket: its rate bucket, its abuse counters, its heartbeat, and
 * the order in which its messages are handled (one after the other).
 */
class LiveConnection {
  #socket;
  #policy;
  #clock;
  /** @type {number} */
  #tokens;
  #refilledAt;
  #violations = 0;
  #badMessages = 0;
  #lastPong;
  #lastSessionCheck;
  /** @type {Promise<void>} */
  #queue = Promise.resolve();

  /**
   * @param {{ socket: import("ws").WebSocket, policy: GatewayPolicy, clock: import("../../kernel/time.js").Clock }} deps
   */
  constructor({ socket, policy, clock }) {
    this.#socket = socket;
    this.#policy = policy;
    this.#clock = clock;
    this.#tokens = policy.rateBurst;
    this.#refilledAt = clock.now();
    this.#lastPong = clock.now();
    this.#lastSessionCheck = clock.now();
    socket.on("pong", () => {
      this.#lastPong = this.#clock.now();
    });
    /** @type {import("./ConnectionHub.js").Connection} */
    this.connection = Object.freeze({
      send: (message) => {
        if (socket.readyState !== socket.OPEN) {
          return;
        }
        if (socket.bufferedAmount > policy.maxBufferedBytes) {
          // A peer that stops reading must not make the server hold its messages without bound.
          socket.terminate();
          return;
        }
        socket.send(message);
      },
      close: (code, reason) => socket.close(code, reason),
    });
  }

  /** @param {(envelope: { t: string, id: string | null, d: Record<string, unknown> }) => Promise<void>} dispatch */
  onMessage(dispatch) {
    this.#socket.on("message", (raw, isBinary) => {
      this.#queue = this.#queue.then(() => this.#receive(raw, isBinary, dispatch));
    });
  }

  /**
   * @param {string} type
   * @param {string | null} id
   * @param {unknown} data
   */
  reply(type, id, data) {
    this.connection.send(JSON.stringify(id === null ? { t: type, d: data } : { t: type, re: id, d: data }));
  }

  /**
   * Pings; drops a silent peer; periodically re-checks the session.
   * @param {() => Promise<boolean>} sessionValid
   */
  async heartbeat(sessionValid) {
    const now = this.#clock.now();
    if (now - this.#lastPong > this.#policy.pongTimeoutMs) {
      this.#socket.terminate();
      return;
    }
    this.#socket.ping();
    if (now - this.#lastSessionCheck >= this.#policy.sessionCheckMs) {
      this.#lastSessionCheck = now;
      if (!(await sessionValid())) {
        this.#socket.close(CloseCode.UNAUTHENTICATED, "session ended");
      }
    }
  }

  /**
   * @param {import("ws").RawData} raw
   * @param {boolean} isBinary
   * @param {(envelope: { t: string, id: string | null, d: Record<string, unknown> }) => Promise<void>} dispatch
   */
  async #receive(raw, isBinary, dispatch) {
    if (!this.#takeToken()) {
      this.#violations += 1;
      this.reply("error", null, { code: "RATE_LIMITED", message: "too many messages" });
      if (this.#violations >= this.#policy.maxRateViolations) {
        this.#socket.close(CloseCode.RATE_LIMITED, "rate limited");
      }
      return;
    }
    const envelope = isBinary ? null : parseEnvelope(raw.toString("utf8"));
    if (envelope === null) {
      this.#badMessages += 1;
      this.reply("error", null, { code: "BAD_MESSAGE", message: "expected {t, id?, d}" });
      if (this.#badMessages >= this.#policy.maxBadMessages) {
        this.#socket.close(CloseCode.BAD_MESSAGE, "malformed messages");
      }
      return;
    }
    await dispatch(envelope);
  }

  #takeToken() {
    const now = this.#clock.now();
    this.#tokens = Math.min(this.#policy.rateBurst, this.#tokens + ((now - this.#refilledAt) / 1000) * this.#policy.ratePerSecond);
    this.#refilledAt = now;
    if (this.#tokens < 1) {
      return false;
    }
    this.#tokens -= 1;
    return true;
  }
}

/**
 * @param {string} text
 * @returns {{ t: string, id: string | null, d: Record<string, unknown> } | null}
 */
function parseEnvelope(text) {
  let value;
  try {
    value = parseJson(text, { maxDepth: 8 });
  } catch {
    return null;
  }
  if (!isPlainObject(value) || Object.keys(value).some((key) => !["t", "id", "d"].includes(key))) {
    return null;
  }
  const { t, id = null, d = {} } = value;
  const typeValid = typeof t === "string" && TYPE_PATTERN.test(t);
  const idValid = id === null || (typeof id === "string" && ID_PATTERN.test(id));
  return typeValid && idValid && isPlainObject(d) ? { t, id, d } : null;
}

/** @param {unknown} value */
/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * @param {import("node:stream").Duplex} socket
 * @param {number} status
 * @param {string} text
 */
function reject(socket, status, text) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
