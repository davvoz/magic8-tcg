/** WebSocket messages of the matchmaking module (docs/tcg/02-protocollo-multiplayer.md §3.3). */
import { checkString } from "@magic8/engine/shared/validation.js";
import { validated } from "../../../platform/http/validateBody.js";

/**
 * @param {{ router: import("../../../platform/realtime/MessageRouter.js").MessageRouter, matchmaking: import("../application/MatchmakingService.js").MatchmakingService }} deps
 */
export function registerQueueMessages({ router, matchmaking }) {
  router.on("queue.join", async ({ principal }, data) => {
    const body = validated(data, ["mode", "deckId"], (issues, object) => {
      checkString(issues, object.mode, "d.mode", { minLength: 1, maxLength: 16 });
      checkString(issues, object.deckId, "d.deckId", { minLength: 1, maxLength: 36 });
    });
    const { user } = principal;
    return { t: "queue.status", d: await matchmaking.join({ user: { id: user.id, account: user.account }, mode: body.mode, deckId: body.deckId }) };
  });

  router.on("queue.leave", async ({ principal }, data) => {
    validated(data, [], () => undefined);
    await matchmaking.leave(principal.user.id);
    return { t: "queue.status", d: { state: "idle" } };
  });
}
