/**
 * WebSocket messages of the gameplay module (docs/tcg/02-protocollo-multiplayer.md §3.3).
 * The player id is never read from a message: the seat comes from the user.
 */
import { checkInteger, checkString } from "@magic8/engine/shared/validation.js";
import { AppError } from "../../../kernel/AppError.js";
import { validated } from "../../../platform/http/validateBody.js";

const GAME_ID = Object.freeze({ minLength: 26, maxLength: 26 });

/**
 * @param {{ router: import("../../../platform/realtime/MessageRouter.js").MessageRouter, games: import("../application/GameService.js").GameService }} deps
 */
export function registerGameMessages({ router, games }) {
  router.on("game.entropy", async ({ principal }, data) => {
    const body = validated(data, ["gameId", "entropy"], (issues, object) => {
      checkString(issues, object.gameId, "d.gameId", GAME_ID);
      checkString(issues, object.entropy, "d.entropy", { minLength: 32, maxLength: 32 });
    });
    const result = await games.entropy(principal.user.id, body.gameId, body.entropy);
    if (!result.ok) {
      throw new AppError("VALIDATION", result.error.message, { code: result.error.code });
    }
    return { t: "game.joined", d: { gameId: body.gameId } };
  });

  router.on("game.command", async ({ principal }, data) => {
    const body = validated(data, ["gameId", "commandId", "expectedVersion", "command"], (issues, object) => {
      checkString(issues, object.gameId, "d.gameId", GAME_ID);
      checkString(issues, object.commandId, "d.commandId", { minLength: 36, maxLength: 36 });
      checkInteger(issues, object.expectedVersion, "d.expectedVersion", { min: 0, max: 1_000_000 });
    });
    const ack = await games.command(principal.user.id, { gameId: body.gameId, commandId: body.commandId, expectedVersion: body.expectedVersion, command: body.command });
    return { t: "game.ack", d: ack };
  });

  router.on("game.concede", async ({ principal }, data) => {
    const body = validated(data, ["gameId", "commandId"], (issues, object) => {
      checkString(issues, object.gameId, "d.gameId", GAME_ID);
      checkString(issues, object.commandId, "d.commandId", { minLength: 36, maxLength: 36 });
    });
    return { t: "game.ack", d: await games.concede(principal.user.id, { gameId: body.gameId, commandId: body.commandId }) };
  });

  router.on("game.sync", async ({ principal }, data) => {
    const body = validated(data, ["gameId"], (issues, object) => checkString(issues, object.gameId, "d.gameId", GAME_ID));
    const view = await games.view(principal.user.id, body.gameId);
    if (view === null) {
      throw new AppError("NOT_FOUND", "no such game");
    }
    return { t: "game.state", d: view };
  });

  router.on("watch.start", async ({ principal }, data) => {
    const body = validated(data, ["gameId"], (issues, object) => checkString(issues, object.gameId, "d.gameId", GAME_ID));
    const result = await games.watch(principal.user.id, body.gameId);
    if (!result.ok) {
      throw new AppError(result.error.code === "NOT_IN_GAME" ? "NOT_FOUND" : "CONFLICT", result.error.message, { code: result.error.code });
    }
    return { t: "watch.state", d: result.view };
  });

  router.on("watch.stop", async ({ principal }, data) => {
    validated(data, [], () => undefined);
    games.unwatch(principal.user.id);
    return { t: "watch.stopped", d: {} };
  });
}
