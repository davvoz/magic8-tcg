/**
 * What the wallet KIJAM keeps signs, asked of the game server
 * (docs/tcg/29-google.md): a transfer that pays an open payment, the
 * authorisation of a game's session key, a ping.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { HttpJsonTransport } from "./HttpJsonTransport.js";

const TX_ID_PATTERN = /^[0-9a-f]{40}$/;
const SIGNATURE_PATTERN = /^[0-9a-f]{130}$/;
const UNEXPECTED = "the game server sent an unexpected response";

export class HttpCustodyApi {
  #transport;

  /** @param {ConstructorParameters<typeof HttpJsonTransport>[0]} deps */
  constructor(deps) {
    this.#transport = new HttpJsonTransport(deps);
  }

  /**
   * @param {import("../../application/ports/WalletConnector.contract.js").TransferRequest} transfer
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail>} the transaction id
   */
  async transfer({ from, to, amount, asset, memo }) {
    return field(await this.#transport.request("POST", "/api/custody/transfers", { body: { from, to, amount, asset, memo } }), "txId", TX_ID_PATTERN);
  }

  /**
   * @param {string} message
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail>} the signature
   */
  async signMessage(message) {
    return field(await this.#transport.request("POST", "/api/custody/messages", { body: { message } }), "signature", SIGNATURE_PATTERN);
  }

  /**
   * @param {Omit<import("../../application/ports/WalletConnector.contract.js").CommentRequest, "author">} comment
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail>} the transaction id
   */
  async ping({ parentAuthor, parentPermlink, permlink, title, body, jsonMetadata }) {
    return field(await this.#transport.request("POST", "/api/custody/pings", { body: { parentAuthor, parentPermlink, permlink, title, body, jsonMetadata } }), "txId", TX_ID_PATTERN);
  }
}

/**
 * @param {import("@magic8/engine/shared/Result.js").Ok<unknown> | import("@magic8/engine/shared/Result.js").Fail} response
 * @param {string} name
 * @param {RegExp} pattern
 * @returns {import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail}
 */
function field(response, name, pattern) {
  if (!response.ok) {
    return response;
  }
  const value = /** @type {any} */ (response.value)?.[name];
  return typeof value === "string" && pattern.test(value) ? ok(value) : fail(ApiFailure.BAD_RESPONSE, UNEXPECTED);
}
