/**
 * The session-level WebSocket messages, which span modules: `hello` (who
 * am I, which game am I in, am I queued) and presence (a connection that
 * comes or goes). A reconnecting client gets its game's full state in the
 * welcome and resumes from there (docs/tcg/02-protocollo-multiplayer.md §3.6).
 */
import { validated } from "./platform/http/validateBody.js";

/**
 * @param {{
 *   router: import("./platform/realtime/MessageRouter.js").MessageRouter,
 *   games: import("./modules/gameplay/index.js").GameService,
 *   matchmaking: import("./modules/matchmaking/index.js").MatchmakingService,
 *   clock: import("./kernel/time.js").Clock,
 * }} deps
 */
export function registerSessionMessages({ router, games, matchmaking, clock }) {
  router.on("hello", async ({ principal }, data) => {
    validated(data, ["resume"], () => undefined);
    const { user } = principal;
    const gameId = await games.activeGameOf(user.id);
    return {
      t: "welcome",
      d: {
        user: { id: user.id, account: user.account, network: user.network },
        serverTime: clock.now(),
        activeGame: gameId === null ? null : await games.view(user.id, gameId),
        queue: await matchmaking.status(user.id),
        // The key that signs acks (docs/tcg/11); the client checks every ack against it.
        ackKey: games.ackKey,
      },
    };
  });
}

/**
 * What happens when a user's connection comes or goes.
 * @param {{ games: import("./modules/gameplay/index.js").GameService, matchmaking: import("./modules/matchmaking/index.js").MatchmakingService }} deps
 * @returns {(userId: string, connected: boolean) => Promise<void>}
 */
export function presenceHandler({ games, matchmaking }) {
  return async (userId, connected) => {
    if (!connected) {
      // Nobody can be matched while away: they would not see the game start.
      await matchmaking.leave(userId);
    }
    await games.presence(userId, connected);
  };
}
