/**
 * HTTP surface of season jackpots: the public jackpot of the season, and for
 * operators the prizes still to pay (with the memo that closes each one).
 */
import { Auth } from "../../../platform/http/Router.js";

const READ_RATE = Object.freeze({ name: "jackpot", capacity: 30, refillPerSecond: 1, by: /** @type {const} */ ("ip") });
const ADMIN_RATE = Object.freeze({ name: "admin", capacity: 60, refillPerSecond: 1, by: /** @type {const} */ ("user") });

/**
 * @param {{
 *   router: import("../../../platform/http/Router.js").Router,
 *   jackpot: import("../application/JackpotService.js").JackpotService,
 *   admin: { requireAdmin: (principal: any) => unknown },
 * }} deps
 */
export function registerJackpotRoutes({ router, jackpot, admin }) {
  router.add({
    method: "GET",
    path: "/api/jackpot",
    auth: Auth.NONE,
    rateLimit: READ_RATE,
    handler: async () => ({ status: 200, body: await jackpot.view(), headers: { "Cache-Control": "public, max-age=15" } }),
  });

  router.add({
    method: "GET",
    path: "/api/admin/prizes",
    auth: Auth.REQUIRED,
    rateLimit: ADMIN_RATE,
    handler: async (context) => {
      admin.requireAdmin(context.principal);
      return { status: 200, body: { prizes: await jackpot.prizes(["PENDING", "SENT"]) } };
    },
  });
}
