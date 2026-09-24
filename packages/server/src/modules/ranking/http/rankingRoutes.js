/**
 * HTTP surface of ranked play: the public leaderboard and a player's own standing.
 */
import { AppError } from "../../../kernel/AppError.js";
import { Auth } from "../../../platform/http/Router.js";

const READ_RATE = Object.freeze({ name: "ranking", capacity: 30, refillPerSecond: 1, by: /** @type {const} */ ("ip") });
const SEASON_ID = /^[a-z0-9-]{1,32}$/;

/**
 * @param {{ router: import("../../../platform/http/Router.js").Router, ranking: import("../application/RankingService.js").RankingService }} deps
 */
export function registerRankingRoutes({ router, ranking }) {
  router.add({
    method: "GET",
    path: "/api/ranking/leaderboard",
    auth: Auth.NONE,
    rateLimit: READ_RATE,
    handler: async (context) => {
      const season = context.query.get("season");
      if (season !== null && !SEASON_ID.test(season)) {
        throw new AppError("VALIDATION", "invalid season");
      }
      return { status: 200, body: await ranking.leaderboard(season), headers: { "Cache-Control": "public, max-age=30" } };
    },
  });

  router.add({
    method: "GET",
    path: "/api/ranking/me",
    auth: Auth.REQUIRED,
    rateLimit: READ_RATE,
    handler: async (context) => ({ status: 200, body: await ranking.standing(context.principal.user.id) }),
  });
}
