/**
 * HTTP surface of the starter offer.
 */
import { checkString } from "@magic8/engine/shared/validation.js";
import { Auth } from "../../../platform/http/Router.js";
import { validated } from "../../../platform/http/validateBody.js";

const CLAIM_KEYS = Object.freeze(["starterId"]);
const CLAIM_RATE = Object.freeze({ name: "starter-claim", capacity: 5, refillPerSecond: 5 / 60, by: /** @type {const} */ ("user") });
const READ_RATE = Object.freeze({ name: "starter-read", capacity: 30, refillPerSecond: 0.5, by: /** @type {const} */ ("user") });

/**
 * @param {{ router: import("../../../platform/http/Router.js").Router, starters: import("../application/StarterService.js").StarterService }} deps
 */
export function registerStarterRoutes({ router, starters }) {
  router.add({
    method: "GET",
    path: "/api/starter",
    auth: Auth.REQUIRED,
    rateLimit: READ_RATE,
    handler: async (context) => ({ status: 200, body: await starters.status(context.principal.user.id) }),
  });

  router.add({
    method: "POST",
    path: "/api/starter",
    auth: Auth.REQUIRED,
    rateLimit: CLAIM_RATE,
    handler: async (context) => {
      const body = validated(await context.readJson(), CLAIM_KEYS, (issues, object) => {
        checkString(issues, object.starterId, "body.starterId", { minLength: 1, maxLength: 40 });
      });
      const claimed = await starters.claim({ userId: context.principal.user.id, starterId: body.starterId, ip: context.ip });
      return { status: 201, body: claimed };
    },
  });
}
