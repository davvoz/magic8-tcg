/**
 * HTTP surface of the daily challenges (docs/tcg/24-sfide.md): today's
 * opponents and the player's progress, the choice of the day's track, and
 * starting the next challenge (the game itself is played over the game
 * protocol, like any other).
 */
import { Auth } from "../../../platform/http/Router.js";

/** Reading the day is cheap; starting games is not: a game a few seconds, at most. */
const READ_RATE = Object.freeze({ name: "daily-read", capacity: 30, refillPerSecond: 1, by: /** @type {const} */ ("user") });
const PLAY_RATE = Object.freeze({ name: "daily-play", capacity: 5, refillPerSecond: 1 / 10, by: /** @type {const} */ ("user") });

/**
 * @param {{ router: import("../../../platform/http/Router.js").Router, daily: import("../application/DailyChallengeService.js").DailyChallengeService }} deps
 */
export function registerDailyRoutes({ router, daily }) {
  router.add({
    method: "GET",
    path: "/api/daily",
    auth: Auth.REQUIRED,
    rateLimit: READ_RATE,
    handler: async (context) => ({ status: 200, body: await daily.today(context.principal.user.id), headers: { "Cache-Control": "no-store" } }),
  });
  router.add({
    method: "POST",
    path: "/api/daily/track",
    auth: Auth.REQUIRED,
    rateLimit: READ_RATE,
    handler: async (context) => {
      const body = /** @type {{ track?: unknown }} */ (await context.readJson());
      return { status: 200, body: await daily.chooseTrack(context.principal.user.id, body?.track) };
    },
  });
  router.add({
    method: "POST",
    path: "/api/daily/play",
    auth: Auth.REQUIRED,
    rateLimit: PLAY_RATE,
    handler: async (context) => {
      const body = /** @type {{ deckId?: unknown }} */ (await context.readJson());
      const { id, account } = context.principal.user;
      return { status: 200, body: await daily.play({ user: { id, account }, deckId: body?.deckId }) };
    },
  });
}
