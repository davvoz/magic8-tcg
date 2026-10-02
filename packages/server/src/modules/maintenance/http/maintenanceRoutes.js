/**
 * HTTP surface of the announced maintenance:
 * - GET /api/maintenance: anyone, signed in or not, reads it when the page loads (then it comes by push),
 *   with the release being served (`version` from package.json, `build` the deployed commit): a tab
 *   running another build (its src/release.js) offers to update;
 * - POST /api/admin/maintenance {minutes, message?}: an operator announces it;
 * - DELETE /api/admin/maintenance: an operator ends it.
 */
import { checkInteger, checkString } from "@magic8/engine/shared/validation.js";
import { Auth } from "../../../platform/http/Router.js";
import { validated } from "../../../platform/http/validateBody.js";
import { MAX_LEAD_MINUTES, MAX_MESSAGE_LENGTH } from "../application/MaintenanceService.js";

const READ_RATE = Object.freeze({ name: "maintenance", capacity: 30, refillPerSecond: 1, by: /** @type {const} */ ("ip") });
const ADMIN_RATE = Object.freeze({ name: "admin", capacity: 60, refillPerSecond: 1, by: /** @type {const} */ ("user") });
const ANNOUNCE_KEYS = Object.freeze(["minutes", "message"]);
const NO_STORE = Object.freeze({ "Cache-Control": "no-store" });

/**
 * @param {{
 *   router: import("../../../platform/http/Router.js").Router,
 *   maintenance: import("../application/MaintenanceService.js").MaintenanceService,
 *   admin: { requireAdmin: (principal: any) => { id: string } },
 *   version?: string | null,
 *   build?: string | null,
 * }} deps `version`: the product version served; `build`: the deployed commit, null in development
 */
export function registerMaintenanceRoutes({ router, maintenance, admin, version = null, build = null }) {
  router.add({
    method: "GET",
    path: "/api/maintenance",
    auth: Auth.NONE,
    rateLimit: READ_RATE,
    handler: async () => ({ status: 200, body: { maintenance: maintenance.current(), version, build }, headers: NO_STORE }),
  });

  router.add({
    method: "POST",
    path: "/api/admin/maintenance",
    auth: Auth.REQUIRED,
    rateLimit: ADMIN_RATE,
    handler: async (context) => {
      const operator = admin.requireAdmin(context.principal);
      const body = validated(await context.readJson(), ANNOUNCE_KEYS, (issues, object) => {
        checkInteger(issues, object.minutes, "body.minutes", { min: 0, max: MAX_LEAD_MINUTES });
        if (object.message !== undefined) {
          checkString(issues, object.message, "body.message", { maxLength: MAX_MESSAGE_LENGTH });
        }
      });
      const announced = await maintenance.announce({ userId: operator.id, ip: context.ip }, { minutes: /** @type {number} */ (body.minutes), message: /** @type {string | undefined} */ (body.message) ?? null });
      return { status: 200, body: { maintenance: announced } };
    },
  });

  router.add({
    method: "DELETE",
    path: "/api/admin/maintenance",
    auth: Auth.REQUIRED,
    rateLimit: ADMIN_RATE,
    handler: async (context) => {
      const operator = admin.requireAdmin(context.principal);
      return { status: 200, body: { ended: await maintenance.end({ userId: operator.id, ip: context.ip }) } };
    },
  });
}
