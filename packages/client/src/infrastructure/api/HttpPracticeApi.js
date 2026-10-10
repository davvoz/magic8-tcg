/**
 * PracticeApi over the game server's HTTP API, with every response checked
 * for the shape the application relies on.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { HttpJsonTransport } from "./HttpJsonTransport.js";

const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

export class HttpPracticeApi {
  #transport;

  /** @param {ConstructorParameters<typeof HttpJsonTransport>[0]} deps */
  constructor(deps) {
    this.#transport = new HttpJsonTransport(deps);
  }

  /** @param {import("../../application/ports/PracticeApi.contract.js").PracticeReport} report */
  async report(report) {
    const response = await this.#transport.request("POST", "/api/practice/games", { body: report });
    if (!response.ok) {
      return response;
    }
    const value = /** @type {any} */ (response.value);
    return typeof value?.counted === "boolean" && isCount(value.practiceGames)
      ? ok(Object.freeze({ counted: value.counted, practiceGames: value.practiceGames }))
      : fail(ApiFailure.BAD_RESPONSE, "the game server sent an unexpected response");
  }
}
