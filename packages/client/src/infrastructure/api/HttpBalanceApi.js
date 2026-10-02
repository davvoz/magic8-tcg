/**
 * BalanceApi over the game server's HTTP API, with the response checked for
 * the shape the application relies on.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { HttpJsonTransport } from "./HttpJsonTransport.js";

const ASSET_PATTERN = /^[A-Z]{1,10}$/;
const AMOUNT_PATTERN = /^\d{1,15}\.\d{1,8}$/;
const MAX_BALANCES = 10;

/**
 * @param {any} value
 * @returns {import("../../application/ports/BalanceApi.contract.js").Balance | null}
 */
function balance(value) {
  return typeof value?.asset === "string" && ASSET_PATTERN.test(value.asset) && typeof value.amount === "string" && AMOUNT_PATTERN.test(value.amount) ? Object.freeze({ asset: value.asset, amount: value.amount }) : null;
}

export class HttpBalanceApi {
  #transport;

  /** @param {ConstructorParameters<typeof HttpJsonTransport>[0]} deps */
  constructor(deps) {
    this.#transport = new HttpJsonTransport(deps);
  }

  async balances() {
    const response = await this.#transport.request("GET", "/api/wallet/balances");
    if (!response.ok) {
      return response;
    }
    const list = /** @type {any} */ (response.value)?.balances;
    const balances = Array.isArray(list) && list.length <= MAX_BALANCES ? list.map(balance) : null;
    return balances === null || balances.includes(null) ? fail(ApiFailure.BAD_RESPONSE, "the game server sent an unexpected response") : ok(Object.freeze(/** @type {import("../../application/ports/BalanceApi.contract.js").Balance[]} */ (balances)));
  }
}
