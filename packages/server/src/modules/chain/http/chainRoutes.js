/**
 * HTTP surface of the chain module. Public: a game's records are public on
 * chain anyway, and verifying must not need an account.
 */
import { AppError } from "../../../kernel/AppError.js";
import { VerificationBusyError } from "../application/GameVerification.js";
import { Auth } from "../../../platform/http/Router.js";

const INDEX_RATE = Object.freeze({ name: "chain-index", capacity: 30, refillPerSecond: 0.5, by: /** @type {const} */ ("ip") });
/** Verifying reads the chain: a few per minute per address. */
const VERIFY_RATE = Object.freeze({ name: "chain-verify", capacity: 3, refillPerSecond: 0.05, by: /** @type {const} */ ("ip") });

/**
 * @param {{ router: import("../../../platform/http/Router.js").Router, verification: import("../application/GameVerification.js").GameVerification }} deps
 */
export function registerChainRoutes({ router, verification }) {
  router.add({
    method: "GET",
    path: "/api/games/:id/chain",
    auth: Auth.NONE,
    rateLimit: INDEX_RATE,
    handler: async (context) => {
      const index = await verification.index(context.params.id);
      if (index === null) {
        throw new AppError("NOT_FOUND", "no records for this game");
      }
      return { status: 200, body: index };
    },
  });

  router.add({
    method: "GET",
    path: "/api/games/:id/verification",
    auth: Auth.NONE,
    rateLimit: VERIFY_RATE,
    handler: async (context) => {
      let result;
      try {
        result = await verification.verify(context.params.id);
      } catch (error) {
        if (error instanceof VerificationBusyError) {
          throw new AppError("RATE_LIMITED", "the server is busy verifying other games; retry in a few seconds");
        }
        throw new AppError("CHAIN_UNAVAILABLE", "the chain cannot be read right now");
      }
      if (result === null) {
        throw new AppError("NOT_FOUND", "no records for this game");
      }
      return { status: 200, body: result };
    },
  });
}
