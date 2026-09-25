/**
 * HTTP surface of gameplay: the public list of games being played now, for
 * anyone who wants to watch one (docs/tcg/10-spettatori.md).
 */
import { Auth } from "../../../platform/http/Router.js";

const READ_RATE = Object.freeze({ name: "live-games", capacity: 30, refillPerSecond: 1, by: /** @type {const} */ ("ip") });

/**
 * @param {{ router: import("../../../platform/http/Router.js").Router, games: import("../application/GameService.js").GameService }} deps
 */
export function registerGameRoutes({ router, games }) {
  router.add({
    method: "GET",
    path: "/api/games/live",
    auth: Auth.NONE,
    rateLimit: READ_RATE,
    handler: async () => ({ status: 200, body: { games: games.liveGames() }, headers: { "Cache-Control": "public, max-age=5" } }),
  });
}
