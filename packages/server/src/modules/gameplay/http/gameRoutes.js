/**
 * HTTP surface of gameplay: the public list of games being played now, for
 * anyone who wants to watch one (docs/tcg/10-spettatori.md), and the games a
 * player has played, public like the leaderboard.
 */
import { AppError } from "../../../kernel/AppError.js";
import { Auth } from "../../../platform/http/Router.js";

const READ_RATE = Object.freeze({ name: "live-games", capacity: 30, refillPerSecond: 1, by: /** @type {const} */ ("ip") });
const HISTORY_RATE = Object.freeze({ name: "game-history", capacity: 30, refillPerSecond: 1, by: /** @type {const} */ ("ip") });
const ACCOUNT = /^[a-z0-9.-]{1,32}$/;
const GAME_ID = /^[0-9a-hjkmnp-tv-z]{26}$/;

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

  router.add({
    method: "GET",
    path: "/api/games/history",
    auth: Auth.NONE,
    rateLimit: HISTORY_RATE,
    handler: async (context) => {
      const account = context.query.get("account");
      const before = context.query.get("before");
      if (account === null || !ACCOUNT.test(account)) {
        throw new AppError("VALIDATION", "invalid account");
      }
      if (before !== null && !GAME_ID.test(before)) {
        throw new AppError("VALIDATION", "invalid before");
      }
      return { status: 200, body: await games.history({ account, before }), headers: { "Cache-Control": "public, max-age=10" } };
    },
  });
}
