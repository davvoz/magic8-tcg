/**
 * What a browser signing with the player's own keys needs from the game
 * server (docs/tcg/20-chiavi.md): which authorities of an account a key
 * controls, the block a transaction must reference, and the relay of a
 * signed transfer. No private key is ever sent: only public keys and
 * signed transactions.
 *
 * @typedef {Readonly<{ blockNum: number, blockId: string, time: number }>} BlockReference
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { HttpJsonTransport } from "./HttpJsonTransport.js";

const ROLES = Object.freeze(["owner", "active", "posting"]);
const BLOCK_ID_PATTERN = /^[0-9a-f]{40}$/;
const TX_ID_PATTERN = /^[0-9a-f]{40}$/;
const UNEXPECTED = "the game server sent an unexpected response";

export class HttpWalletApi {
  #transport;

  /** @param {ConstructorParameters<typeof HttpJsonTransport>[0]} deps */
  constructor(deps) {
    this.#transport = new HttpJsonTransport(deps);
  }

  /**
   * @param {string} account
   * @param {string} publicKey "STM…"
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<readonly string[]> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async keyRoles(account, publicKey) {
    const response = await this.#transport.request("POST", "/api/auth/key-roles", { body: { account, publicKey } });
    if (!response.ok) {
      return response;
    }
    const roles = /** @type {any} */ (response.value)?.roles;
    return Array.isArray(roles) && roles.every((role) => ROLES.includes(role)) ? ok(Object.freeze([...roles])) : fail(ApiFailure.BAD_RESPONSE, UNEXPECTED);
  }

  /** @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<BlockReference> | import("@magic8/engine/shared/Result.js").Fail>} */
  async reference() {
    const response = await this.#transport.request("GET", "/api/wallet/reference");
    if (!response.ok) {
      return response;
    }
    const body = /** @type {any} */ (response.value);
    const valid = Number.isSafeInteger(body?.blockNum) && body.blockNum > 0 && typeof body.blockId === "string" && BLOCK_ID_PATTERN.test(body.blockId) && Number.isSafeInteger(body.time);
    return valid ? ok(Object.freeze({ blockNum: body.blockNum, blockId: body.blockId, time: body.time })) : fail(ApiFailure.BAD_RESPONSE, UNEXPECTED);
  }

  /**
   * @param {Readonly<Record<string, unknown>>} transaction signed, in the node's JSON form
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail>} the transaction id
   */
  async broadcastTransfer(transaction) {
    const response = await this.#transport.request("POST", "/api/wallet/transfers", { body: { transaction } });
    if (!response.ok) {
      return response;
    }
    const txId = /** @type {any} */ (response.value)?.txId;
    return typeof txId === "string" && TX_ID_PATTERN.test(txId) ? ok(txId) : fail(ApiFailure.BAD_RESPONSE, UNEXPECTED);
  }
}
