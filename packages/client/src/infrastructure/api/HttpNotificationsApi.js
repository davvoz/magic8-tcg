/**
 * NotificationsApi over the game server's HTTP API, with every response
 * checked for the shape the application relies on.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { parseNotification } from "../../application/notifications/parseNotification.js";
import { HttpJsonTransport } from "./HttpJsonTransport.js";

const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const badResponse = () => fail(ApiFailure.BAD_RESPONSE, "the game server sent an unexpected response");

export class HttpNotificationsApi {
  #transport;

  /** @param {ConstructorParameters<typeof HttpJsonTransport>[0]} deps */
  constructor(deps) {
    this.#transport = new HttpJsonTransport(deps);
  }

  /** @param {number} [before] */
  async list(before) {
    const response = await this.#transport.request("GET", before === undefined ? "/api/notifications" : `/api/notifications?before=${encodeURIComponent(String(before))}`);
    if (!response.ok) {
      return response;
    }
    const body = /** @type {any} */ (response.value);
    const notifications = Array.isArray(body?.notifications) ? body.notifications.map(parseNotification) : null;
    if (notifications === null || notifications.includes(null) || !isCount(body.unread) || typeof body.more !== "boolean") {
      return badResponse();
    }
    return ok(Object.freeze({ notifications: Object.freeze(notifications), unread: body.unread, more: body.more }));
  }

  /** @param {{ ids: readonly number[] } | { all: true }} request */
  async markRead(request) {
    const response = await this.#transport.request("POST", "/api/notifications/read", { body: request });
    if (!response.ok) {
      return response;
    }
    const unread = /** @type {any} */ (response.value)?.unread;
    return isCount(unread) ? ok(Object.freeze({ unread })) : badResponse();
  }
}
