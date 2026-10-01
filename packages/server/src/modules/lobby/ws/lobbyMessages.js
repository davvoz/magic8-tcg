/** WebSocket messages of the lobby module (docs/tcg/17-lobby-e-sfide.md). */
import { checkString } from "@magic8/engine/shared/validation.js";
import { validated } from "../../../platform/http/validateBody.js";

/**
 * @param {{ router: import("../../../platform/realtime/MessageRouter.js").MessageRouter, lobby: import("../application/LobbyService.js").LobbyService }} deps
 */
export function registerLobbyMessages({ router, lobby }) {
  /** @param {any} principal */
  const partyOf = (principal) => ({ userId: principal.user.id, account: principal.user.account });

  router.on("lobby.list", async ({ principal }, data) => {
    validated(data, [], () => undefined);
    return { t: "lobby.players", d: await lobby.view(principal.user.id) };
  });

  router.on("challenge.send", async ({ principal }, data) => {
    const body = validated(data, ["to", "mode", "deckId"], (issues, object) => {
      checkString(issues, object.to, "d.to", { minLength: 1, maxLength: 40 });
      checkString(issues, object.mode, "d.mode", { minLength: 1, maxLength: 16 });
      checkString(issues, object.deckId, "d.deckId", { minLength: 1, maxLength: 36 });
    });
    return { t: "challenge.sent", d: await lobby.challenge({ user: partyOf(principal), to: body.to, mode: body.mode, deckId: body.deckId }) };
  });

  router.on("challenge.accept", async ({ principal }, data) => {
    const body = validated(data, ["challengeId", "deckId"], (issues, object) => {
      checkString(issues, object.challengeId, "d.challengeId", { minLength: 1, maxLength: 36 });
      checkString(issues, object.deckId, "d.deckId", { minLength: 1, maxLength: 36 });
    });
    return { t: "challenge.accepted", d: await lobby.accept({ user: partyOf(principal), challengeId: body.challengeId, deckId: body.deckId }) };
  });

  router.on("challenge.decline", async ({ principal }, data) => {
    const body = validated(data, ["challengeId"], (issues, object) => checkString(issues, object.challengeId, "d.challengeId", { minLength: 1, maxLength: 36 }));
    return { t: "challenge.declined", d: lobby.decline({ user: partyOf(principal), challengeId: body.challengeId }) };
  });

  router.on("challenge.cancel", async ({ principal }, data) => {
    const body = validated(data, ["challengeId"], (issues, object) => checkString(issues, object.challengeId, "d.challengeId", { minLength: 1, maxLength: 36 }));
    return { t: "challenge.cancelled", d: lobby.cancel({ user: partyOf(principal), challengeId: body.challengeId }) };
  });
}
