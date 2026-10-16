/**
 * HTTP surface of sharing a game as a ping on cur8.fun: where to post (the
 * latest wall), the players' profile pictures for the picture of the
 * result, hosting that picture, and the relay of a ping signed with the
 * posting key.
 */
import { Auth } from "../../../platform/http/Router.js";
import { validated } from "../../../platform/http/validateBody.js";
import { MAX_PING_IMAGE_BYTES } from "../application/PingService.js";

const WALL_RATE = Object.freeze({ name: "pings-wall", capacity: 20, refillPerSecond: 1 / 3, by: /** @type {const} */ ("user") });
/** A ping is shared now and then, at the end of a game. */
const RELAY_RATE = Object.freeze({ name: "pings-relay", capacity: 5, refillPerSecond: 1 / 60, by: /** @type {const} */ ("user") });
const IMAGE_RATE = Object.freeze({ name: "pings-image", capacity: 5, refillPerSecond: 1 / 60, by: /** @type {const} */ ("user") });
/** Two faces per shared game, kept a while: a few a minute is plenty. */
const AVATAR_RATE = Object.freeze({ name: "pings-avatar", capacity: 10, refillPerSecond: 1 / 6, by: /** @type {const} */ ("user") });
const RELAY_KEYS = Object.freeze(["transaction"]);
const IMAGE_KEYS = Object.freeze(["image"]);
/** A picture's request: the image in base64 (MAX_PING_IMAGE_BYTES, a third more), and its JSON. */
const IMAGE_BODY_BYTES = Math.ceil((MAX_PING_IMAGE_BYTES * 4) / 3) + 1024;

/**
 * @param {{ router: import("../../../platform/http/Router.js").Router, pings: import("../application/PingService.js").PingService, avatars?: import("../application/AvatarProxy.js").AvatarProxy | null }} deps
 */
export function registerPingRoutes({ router, pings, avatars = null }) {
  if (avatars !== null) {
    router.add({
      method: "GET",
      path: "/api/pings/avatars/:account",
      auth: Auth.REQUIRED,
      rateLimit: AVATAR_RATE,
      handler: async (context) => ({ status: 200, body: { image: await avatars.pictureOf(context.params.account) }, headers: { "Cache-Control": "private, max-age=600" } }),
    });
  }
  router.add({
    method: "GET",
    path: "/api/pings/wall",
    auth: Auth.REQUIRED,
    rateLimit: WALL_RATE,
    handler: async () => ({ status: 200, body: await pings.latestWall(), headers: { "Cache-Control": "no-store" } }),
  });
  router.add({
    method: "POST",
    path: "/api/pings/images",
    auth: Auth.REQUIRED,
    rateLimit: IMAGE_RATE,
    maxBodyBytes: IMAGE_BODY_BYTES,
    handler: async (context) => {
      const body = validated(await context.readJson(), IMAGE_KEYS, () => undefined);
      return { status: 201, body: { url: await pings.uploadImage(context.principal.user, body.image, context.ip) } };
    },
  });
  router.add({
    method: "POST",
    path: "/api/pings",
    auth: Auth.REQUIRED,
    rateLimit: RELAY_RATE,
    handler: async (context) => {
      const body = validated(await context.readJson(), RELAY_KEYS, (issues, object) => {
        if (object.transaction === null || typeof object.transaction !== "object" || Array.isArray(object.transaction)) {
          issues.add("body.transaction", "expected a signed transaction");
        }
      });
      return { status: 201, body: { txId: await pings.relay(context.principal.user, body.transaction, context.ip) } };
    },
  });
}
