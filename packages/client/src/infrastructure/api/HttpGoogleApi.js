/**
 * GoogleApi over the game server's HTTP API (docs/tcg/29-google.md).
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { HttpJsonTransport } from "./HttpJsonTransport.js";

const REASONS = Object.freeze(["invalid", "taken", null]);
const UNEXPECTED = "the game server sent an unexpected response";

export class HttpGoogleApi {
  #transport;

  /** @param {ConstructorParameters<typeof HttpJsonTransport>[0]} deps */
  constructor(deps) {
    this.#transport = new HttpJsonTransport(deps);
  }

  get startPath() {
    return "/api/auth/google/start";
  }

  async offered() {
    const response = await this.#transport.request("GET", "/api/auth/options");
    return response.ok ? ok(/** @type {any} */ (response.value)?.google === true) : response;
  }

  /** @param {string} name */
  async nameStatus(name) {
    const response = await this.#transport.request("GET", `/api/auth/google/names?name=${encodeURIComponent(name)}`);
    if (!response.ok) {
      return response;
    }
    const body = /** @type {any} */ (response.value);
    const valid = typeof body?.name === "string" && typeof body.available === "boolean" && REASONS.includes(body.reason);
    return valid ? ok(Object.freeze({ name: body.name, available: body.available, reason: body.reason })) : fail(ApiFailure.BAD_RESPONSE, UNEXPECTED);
  }

  /** @param {string} name */
  async createAccount(name) {
    const response = await this.#transport.request("POST", "/api/auth/google/accounts", { body: { account: name } });
    if (!response.ok) {
      return response;
    }
    const user = /** @type {any} */ (response.value)?.user;
    const valid = typeof user?.id === "string" && typeof user.network === "string" && typeof user.account === "string";
    return valid ? ok(Object.freeze({ id: user.id, network: user.network, account: user.account })) : fail(ApiFailure.BAD_RESPONSE, UNEXPECTED);
  }
}
