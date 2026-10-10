/**
 * HTTP surface of practice games: the signed-in player sends a game against
 * the AI they finished, to have it counted toward ranked play.
 */
import { Auth } from "../../../platform/http/Router.js";

/** A few games in a row, then one a minute: nobody finishes games against the AI faster. */
const REPORT_RATE = Object.freeze({ name: "practice-report", capacity: 5, refillPerSecond: 1 / 60, by: /** @type {const} */ ("user") });
/** A whole game's moves and both decks: far more than the default body (a long game is ~15 KB). */
const REPORT_MAX_BYTES = 256 * 1024;

/**
 * @param {{ router: import("../../../platform/http/Router.js").Router, practice: import("../application/PracticeService.js").PracticeService }} deps
 */
export function registerPracticeRoutes({ router, practice }) {
  router.add({
    method: "POST",
    path: "/api/practice/games",
    auth: Auth.REQUIRED,
    rateLimit: REPORT_RATE,
    maxBodyBytes: REPORT_MAX_BYTES,
    handler: async (context) => ({ status: 200, body: await practice.report(context.principal.user.id, await context.readJson()) }),
  });
}
