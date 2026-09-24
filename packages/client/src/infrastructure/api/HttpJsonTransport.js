/**
 * JSON over the game server's HTTP API (same origin), shared by the API
 * adapters. Every mutating request carries the anti-CSRF header the server
 * requires; cookies are sent same-origin only. Transport failures and error
 * bodies become Results, never exceptions.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";

const CSRF_HEADERS = Object.freeze({ "Content-Type": "application/json", "X-M8-Request": "1" });

export class HttpJsonTransport {
  #fetch;
  #base;

  /**
   * @param {{ fetch: typeof fetch, base?: string }} deps `base` is "" for same origin
   */
  constructor({ fetch: fetchImpl, base = "" }) {
    this.#fetch = fetchImpl;
    this.#base = base;
  }

  /**
   * @param {string} method
   * @param {string} path
   * @param {{ body?: unknown, headers?: Readonly<Record<string, string>> }} [options]
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<unknown> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async request(method, path, { body, headers = {} } = {}) {
    let response;
    try {
      response = await this.#fetch(`${this.#base}${path}`, {
        method,
        credentials: "same-origin",
        headers: { ...(method === "GET" ? { Accept: "application/json" } : CSRF_HEADERS), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return fail(ApiFailure.NETWORK, "the game server could not be reached");
    }
    const payload = await readJson(response);
    return response.ok ? ok(payload) : failureOf(response.status, payload);
  }
}

/**
 * The server's own error when the body carries one, a generic one otherwise.
 * @param {number} status
 * @param {unknown} payload
 */
function failureOf(status, payload) {
  const error = /** @type {any} */ (payload)?.error;
  if (typeof error?.code === "string" && typeof error?.message === "string") {
    return fail(error.code, error.message, error.details ?? null);
  }
  return fail(status === 404 || status >= 500 ? ApiFailure.UNAVAILABLE : ApiFailure.BAD_RESPONSE, `the game server answered ${status}`);
}

/** @param {Response} response */
async function readJson(response) {
  try {
    const text = await response.text();
    return text === "" ? null : JSON.parse(text);
  } catch {
    return null;
  }
}
