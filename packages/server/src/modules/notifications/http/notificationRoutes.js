/**
 * HTTP surface of notifications (docs/tcg/15-notifiche.md): a player's own
 * feed, a page at a time, and marking it read. New notifications are pushed
 * on the player's WebSocket (`notification`).
 */
import { Auth } from "../../../platform/http/Router.js";
import { validated } from "../../../platform/http/validateBody.js";

const READ_RATE = Object.freeze({ name: "notifications-read", capacity: 60, refillPerSecond: 1, by: /** @type {const} */ ("user") });
const WRITE_RATE = Object.freeze({ name: "notifications-write", capacity: 60, refillPerSecond: 1, by: /** @type {const} */ ("user") });

/**
 * @param {{ router: import("../../../platform/http/Router.js").Router, notifications: import("../application/NotificationService.js").NotificationService }} deps
 */
export function registerNotificationRoutes({ router, notifications }) {
  router.add({
    method: "GET",
    path: "/api/notifications",
    auth: Auth.REQUIRED,
    rateLimit: READ_RATE,
    handler: async (context) => ({ status: 200, body: await notifications.list(context.principal.user.id, context.query.get("before") ?? undefined) }),
  });

  router.add({
    method: "POST",
    path: "/api/notifications/read",
    auth: Auth.REQUIRED,
    rateLimit: WRITE_RATE,
    handler: async (context) => {
      const body = validated(await context.readJson(), ["all", "ids"], () => undefined);
      return { status: 200, body: await notifications.markRead(context.principal.user.id, body) };
    },
  });
}
