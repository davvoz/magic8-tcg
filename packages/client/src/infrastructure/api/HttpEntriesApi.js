/**
 * EntriesApi over the game server's HTTP API, with every response checked
 * for the shape the application relies on.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { HttpJsonTransport } from "./HttpJsonTransport.js";

const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

/**
 * @param {any} value
 * @returns {import("../../application/ports/EntriesApi.contract.js").Entries | null}
 */
function entries(value) {
  const valid = value !== null && typeof value === "object" && typeof value.kind === "string" && isCount(value.balance) && isCount(value.perGame) && (value.season === null || typeof value.season === "string");
  return valid ? Object.freeze({ kind: value.kind, balance: value.balance, perGame: value.perGame, season: value.season }) : null;
}

export class HttpEntriesApi {
  #transport;

  /** @param {ConstructorParameters<typeof HttpJsonTransport>[0]} deps */
  constructor(deps) {
    this.#transport = new HttpJsonTransport(deps);
  }

  async entries() {
    const response = await this.#transport.request("GET", "/api/entries");
    if (!response.ok) {
      return response;
    }
    const list = /** @type {any} */ (response.value)?.entries;
    const parsed = Array.isArray(list) ? list.map(entries) : null;
    return parsed === null || parsed.some((item) => item === null) ? fail(ApiFailure.BAD_RESPONSE, "the game server sent an unexpected response") : ok(Object.freeze(/** @type {import("../../application/ports/EntriesApi.contract.js").Entries[]} */ (parsed)));
  }
}
