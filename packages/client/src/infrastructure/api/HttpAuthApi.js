/**
 * AuthApi over the game server's HTTP API. Responses are parsed
 * defensively and mapped to Results.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { HttpJsonTransport } from "./HttpJsonTransport.js";

const ACCOUNT_KEYS = Object.freeze(["id", "network", "account"]);

/**
 * @param {unknown} value
 * @returns {import("../../application/ports/AuthApi.contract.js").SessionUser | null}
 */
function sessionUser(value) {
  if (value === null || typeof value !== "object" || !ACCOUNT_KEYS.every((key) => typeof (/** @type {any} */ (value)[key]) === "string")) {
    return null;
  }
  const user = /** @type {any} */ (value);
  return Object.freeze({ id: user.id, network: user.network, account: user.account });
}

export class HttpAuthApi {
  #transport;

  /**
   * @param {{ fetch: typeof fetch, base?: string }} deps `base` is "" for same origin
   */
  constructor(deps) {
    this.#transport = new HttpJsonTransport(deps);
  }

  async currentUser() {
    const response = await this.#transport.request("GET", "/api/me");
    if (!response.ok) {
      return response.error.code === "UNAUTHENTICATED" ? ok(null) : response;
    }
    const user = sessionUser(/** @type {any} */ (response.value)?.user);
    return user === null ? fail(ApiFailure.BAD_RESPONSE, "unexpected response") : ok(user);
  }

  /** @param {string} account */
  async createChallenge(account) {
    const response = await this.#transport.request("POST", "/api/auth/challenges", { body: { account } });
    if (!response.ok) {
      return response;
    }
    const body = /** @type {any} */ (response.value);
    const valid = body !== null && typeof body === "object" && typeof body.challengeId === "string" && typeof body.message === "string" && typeof body.keyRole === "string" && Number.isFinite(body.expiresAt);
    return valid ? ok(Object.freeze({ challengeId: body.challengeId, message: body.message, keyRole: body.keyRole, expiresAt: body.expiresAt })) : fail(ApiFailure.BAD_RESPONSE, "unexpected response");
  }

  /** @param {{ challengeId: string, signature: string }} proof */
  async createSession({ challengeId, signature }) {
    const response = await this.#transport.request("POST", "/api/auth/sessions", { body: { challengeId, signature } });
    if (!response.ok) {
      return response;
    }
    const user = sessionUser(/** @type {any} */ (response.value)?.user);
    return user === null ? fail(ApiFailure.BAD_RESPONSE, "unexpected response") : ok(user);
  }

  async deleteSession() {
    const response = await this.#transport.request("DELETE", "/api/auth/sessions/current");
    return response.ok || response.error.code === "UNAUTHENTICATED" ? ok(null) : response;
  }
}
