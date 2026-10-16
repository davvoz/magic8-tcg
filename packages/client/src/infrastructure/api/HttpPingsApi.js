/**
 * PingsApi over the game server's HTTP API: the latest wall, the hosting of
 * a ping's picture, and players' profile pictures passed through the server
 * (so the picture of a shared game can show them), their shapes checked.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { HttpJsonTransport } from "./HttpJsonTransport.js";

const ACCOUNT_PATTERN = /^[a-z][a-z0-9.-]{2,15}$/;
const PERMLINK_PATTERN = /^[a-z0-9-]{1,256}$/;
const MAX_URL_LENGTH = 500;
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const UNEXPECTED = "the game server sent an unexpected response";

export class HttpPingsApi {
  #transport;

  /** @param {ConstructorParameters<typeof HttpJsonTransport>[0]} deps */
  constructor(deps) {
    this.#transport = new HttpJsonTransport(deps);
  }

  async wall() {
    const response = await this.#transport.request("GET", "/api/pings/wall");
    if (!response.ok) {
      return response;
    }
    const wall = /** @type {any} */ (response.value);
    return typeof wall?.author === "string" && ACCOUNT_PATTERN.test(wall.author) && typeof wall.permlink === "string" && PERMLINK_PATTERN.test(wall.permlink)
      ? ok(Object.freeze({ author: wall.author, permlink: wall.permlink, images: wall.images === true }))
      : fail(ApiFailure.BAD_RESPONSE, UNEXPECTED);
  }

  /**
   * A player's profile picture, as a data URL (the page's own, so a canvas that draws it can still be saved).
   * @param {string} account
   */
  async avatar(account) {
    if (!ACCOUNT_PATTERN.test(account)) {
      return fail(ApiFailure.BAD_RESPONSE, "not an account name");
    }
    const response = await this.#transport.request("GET", `/api/pings/avatars/${account}`);
    if (!response.ok) {
      return response;
    }
    const image = /** @type {any} */ (response.value)?.image;
    return typeof image === "string" && IMAGE_DATA_URL.test(image) ? ok(image) : fail(ApiFailure.BAD_RESPONSE, UNEXPECTED);
  }

  /** @param {string} image a JPEG, base64-encoded */
  async uploadImage(image) {
    const response = await this.#transport.request("POST", "/api/pings/images", { body: { image } });
    if (!response.ok) {
      return response;
    }
    const url = /** @type {any} */ (response.value)?.url;
    return typeof url === "string" && url.startsWith("https://") && url.length <= MAX_URL_LENGTH ? ok(url) : fail(ApiFailure.BAD_RESPONSE, UNEXPECTED);
  }
}
