/**
 * HTTP surface of the auto list: a played auto game, public like the game
 * history, with everything needed to replay it and check it (its events, the
 * styles, the tickets' secrets and entropies).
 */
import { AppError } from "../../../kernel/AppError.js";
import { Auth } from "../../../platform/http/Router.js";

const REPLAY_RATE = Object.freeze({ name: "auto-replay", capacity: 30, refillPerSecond: 1, by: /** @type {const} */ ("ip") });
const GAME_ID = /^[0-9a-hjkmnp-tv-z]{26}$/;

/**
 * @param {{ router: import("../../../platform/http/Router.js").Router, auto: import("../application/AutoService.js").AutoService }} deps
 */
export function registerAutoRoutes({ router, auto }) {
  router.add({
    method: "GET",
    path: "/api/auto/games/:gameId",
    auth: Auth.NONE,
    rateLimit: REPLAY_RATE,
    handler: async (context) => {
      const { gameId } = context.params;
      if (!GAME_ID.test(gameId)) {
        throw new AppError("VALIDATION", "invalid game id");
      }
      const replay = await auto.replay(gameId);
      if (replay === null) {
        throw new AppError("NOT_FOUND", "no such auto game");
      }
      // A finished game never changes.
      return { status: 200, body: replay, headers: { "Cache-Control": "public, max-age=3600, immutable" } };
    },
  });
}
