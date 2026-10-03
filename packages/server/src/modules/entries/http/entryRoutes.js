/**
 * HTTP surface of entries: a player's own balances, and what a game of each
 * paid mode costs now. Entries are bought through the shop's orders.
 */
import { Auth } from "../../../platform/http/Router.js";

const READ_RATE = Object.freeze({ name: "entries-read", capacity: 60, refillPerSecond: 1, by: /** @type {const} */ ("user") });

/**
 * @param {{ router: import("../../../platform/http/Router.js").Router, entries: import("../application/EntryService.js").EntryService }} deps
 */
export function registerEntryRoutes({ router, entries }) {
  router.add({
    method: "GET",
    path: "/api/entries",
    auth: Auth.REQUIRED,
    rateLimit: READ_RATE,
    handler: async (context) => ({ status: 200, body: { entries: await entries.view(context.principal.user.id) } }),
  });
}
