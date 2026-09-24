/**
 * The HTTP entry point. For every request, in order:
 *   1. bounded URL and method, request id, security headers;
 *   2. route lookup (API) or static files (GET/HEAD only);
 *   3. principal from the session cookie (routes that ask for it);
 *   4. CSRF guard on state-changing routes: Origin in the allowlist,
 *      a custom header a cross-site form cannot set, Sec-Fetch-Site;
 *   5. rate limit (per IP or per user);
 *   6. handler; AppError → its status and code, anything else → 500
 *      without internals.
 */
import { AppError } from "../../kernel/AppError.js";
import { readJsonBody } from "./body.js";
import { parseCookies } from "./cookies.js";
import { Auth } from "./Router.js";
import { clientAddress } from "./clientAddress.js";

export const CSRF_HEADER = "x-m8-request";
const MAX_URL_LENGTH = 2048;
const ALLOWED_METHODS = Object.freeze(["GET", "HEAD", "POST", "PUT", "DELETE"]);
const API_PREFIX = "/api/";

const BASE_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
});
const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

/**
 * @typedef {{
 *   allowedOrigins: readonly string[],
 *   trustProxy: boolean,
 *   maxBodyBytes: number,
 *   hsts: boolean,
 *   sessionCookieName: string,
 * }} HttpConfig
 * @typedef {{ handle: (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse, path: string) => Promise<boolean> }} StaticHandler
 */

export class HttpApp {
  #router;
  #config;
  #logger;
  #rateLimiter;
  #authenticate;
  #staticFiles;
  #nextRequest = 1;

  /**
   * @param {{
   *   router: import("./Router.js").Router,
   *   config: HttpConfig,
   *   logger: import("../../kernel/logger.js").Logger,
   *   rateLimiter: import("./RateLimiter.js").RateLimiter,
   *   authenticate: (sessionToken: string | null, meta: { ip: string }) => Promise<unknown>,
   *   staticFiles?: StaticHandler | null,
   * }} deps
   */
  constructor({ router, config, logger, rateLimiter, authenticate, staticFiles = null }) {
    this.#router = router;
    this.#config = Object.freeze({ ...config, allowedOrigins: Object.freeze([...config.allowedOrigins]) });
    this.#logger = logger;
    this.#rateLimiter = rateLimiter;
    this.#authenticate = authenticate;
    this.#staticFiles = staticFiles;
  }

  /** The `request` listener for node:http. */
  get listener() {
    return (/** @type {import("node:http").IncomingMessage} */ request, /** @type {import("node:http").ServerResponse} */ response) => {
      this.#handle(request, response).catch((error) => {
        this.#logger.error("unhandled request failure", { error });
        if (!response.headersSent) {
          sendJson(response, 500, { error: { code: "INTERNAL", message: "internal error" } });
        }
      });
    };
  }

  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   */
  async #handle(request, response) {
    this.#applyBaseHeaders(response);
    const url = parseUrl(request.url);
    if (url === null || !ALLOWED_METHODS.includes(request.method ?? "")) {
      sendError(response, new AppError(url === null ? "VALIDATION" : "METHOD_NOT_ALLOWED", "bad request"));
      return;
    }
    if (await this.#serveStatic(request, response, url.pathname)) {
      return;
    }
    response.setHeader("Content-Security-Policy", API_CSP);
    response.setHeader("Cache-Control", "no-store");
    await this.#dispatch(request, response, url);
  }

  /** @param {import("node:http").ServerResponse} response */
  #applyBaseHeaders(response) {
    for (const [name, value] of Object.entries(BASE_HEADERS)) {
      response.setHeader(name, value);
    }
    if (this.#config.hsts) {
      response.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    }
  }

  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   * @param {string} pathname
   * @returns {Promise<boolean>} true when a static file was sent
   */
  async #serveStatic(request, response, pathname) {
    const readOnly = request.method === "GET" || request.method === "HEAD";
    if (this.#staticFiles === null || !readOnly || pathname.startsWith(API_PREFIX)) {
      return false;
    }
    return this.#staticFiles.handle(request, response, pathname);
  }

  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   * @param {URL} url
   */
  async #dispatch(request, response, url) {
    const requestId = `r${this.#nextRequest++}`;
    const method = request.method === "HEAD" ? "GET" : /** @type {string} */ (request.method);
    const match = this.#router.match(method, url.pathname);
    if (match.route === null) {
      sendError(response, new AppError(match.methodMismatch ? "METHOD_NOT_ALLOWED" : "NOT_FOUND", match.methodMismatch ? "method not allowed" : "not found"));
      return;
    }
    try {
      const context = await this.#context({ request, url, route: match.route, params: match.params, requestId });
      sendRouteResponse(response, await match.route.handler(context));
    } catch (error) {
      if (!(error instanceof AppError)) {
        this.#logger.error("request failed", { requestId, route: `${method} ${match.route.path}`, error });
      }
      sendError(response, error instanceof AppError ? error : new AppError("INTERNAL", "internal error"));
    }
  }

  /**
   * Builds the context and enforces the route's security requirements.
   * @param {{ request: import("node:http").IncomingMessage, url: URL, route: import("./Router.js").RouteDefinition, params: Readonly<Record<string, string>>, requestId: string }} input
   * @returns {Promise<import("./Router.js").RouteContext>}
   */
  async #context({ request, url, route, params, requestId }) {
    const ip = this.#clientIp(request);
    const origin = typeof request.headers.origin === "string" ? request.headers.origin : null;
    const cookies = parseCookies(request.headers.cookie);
    if (route.csrf) {
      this.#checkCsrf(request, origin);
    }
    const principal = route.auth === Auth.NONE ? null : await this.#authenticate(cookies.get(this.#config.sessionCookieName) ?? null, { ip });
    if (route.auth === Auth.REQUIRED && principal === null) {
      throw new AppError("UNAUTHENTICATED", "sign in first");
    }
    if (route.rateLimit !== undefined) {
      const key = route.rateLimit.by === "user" && principal !== null ? `u:${/** @type {any} */ (principal).user.id}` : `ip:${ip}`;
      const verdict = this.#rateLimiter.take(route.rateLimit, key);
      if (!verdict.allowed) {
        throw new AppError("RATE_LIMITED", "too many requests", { retryAfterSeconds: verdict.retryAfterSeconds });
      }
    }
    let body;
    return Object.freeze({
      method: route.method,
      path: url.pathname,
      params,
      query: url.searchParams,
      ip,
      origin,
      cookies,
      principal,
      requestId,
      header: (name) => {
        const value = request.headers[name.toLowerCase()];
        return typeof value === "string" ? value : null;
      },
      readJson: async () => {
        body ??= readJsonBody(request, this.#config.maxBodyBytes);
        return body;
      },
    });
  }

  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {string | null} origin
   */
  #checkCsrf(request, origin) {
    const site = request.headers["sec-fetch-site"];
    const trustedOrigin = origin !== null && this.#config.allowedOrigins.includes(origin);
    const customHeader = request.headers[CSRF_HEADER] === "1";
    const sameSite = site === undefined || site === "same-origin";
    if (!trustedOrigin || !customHeader || !sameSite) {
      throw new AppError("CSRF_REJECTED", "cross-site request rejected");
    }
  }

  /** @param {import("node:http").IncomingMessage} request */
  #clientIp(request) {
    return clientAddress(request, this.#config.trustProxy);
  }
}

/** @param {string | undefined} raw */
function parseUrl(raw) {
  if (typeof raw !== "string" || raw.length > MAX_URL_LENGTH || !raw.startsWith("/")) {
    return null;
  }
  try {
    const url = new URL(raw, "http://localhost");
    return url.pathname.includes("\0") ? null : url;
  } catch {
    return null;
  }
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 * @param {Readonly<Record<string, string>>} [headers]
 */
function sendJson(response, status, body, headers = {}) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  response.writeHead(status, { ...headers, ...(payload === "" ? {} : { "Content-Type": "application/json; charset=utf-8" }), "Content-Length": Buffer.byteLength(payload) });
  response.end(payload);
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {import("./Router.js").RouteResponse} result
 */
function sendRouteResponse(response, result) {
  if (result.cookies !== undefined && result.cookies.length > 0) {
    response.setHeader("Set-Cookie", [...result.cookies]);
  }
  if (result.raw !== undefined) {
    response.writeHead(result.status, { ...result.headers, "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(result.raw) });
    response.end(result.raw);
    return;
  }
  sendJson(response, result.status, result.body, result.headers);
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {AppError} error
 */
function sendError(response, error) {
  const headers = error.code === "RATE_LIMITED" && error.details !== null ? { "Retry-After": String(error.details.retryAfterSeconds) } : {};
  sendJson(response, error.status, { error: { code: error.code, message: error.message, ...(error.details === null ? {} : { details: error.details }) } }, headers);
}
