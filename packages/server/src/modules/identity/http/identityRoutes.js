/**
 * HTTP surface of the identity module (docs/tcg/02-protocollo-multiplayer.md §2).
 */
import { checkString } from "@magic8/engine/shared/validation.js";
import { serializeCookie } from "../../../platform/http/cookies.js";
import { Auth } from "../../../platform/http/Router.js";
import { validated } from "../../../platform/http/validateBody.js";

const CHALLENGE_KEYS = Object.freeze(["account", "network"]);
const SESSION_KEYS = Object.freeze(["challengeId", "signature"]);
const AUTH_RATE = Object.freeze({ name: "auth", capacity: 10, refillPerSecond: 10 / 60, by: /** @type {const} */ ("ip") });
/** Each read asks a STEEM node: a few per minute is plenty for a player looking at prices. */
const BALANCE_RATE = Object.freeze({ name: "wallet-balance", capacity: 10, refillPerSecond: 10 / 60, by: /** @type {const} */ ("user") });

/**
 * @param {import("../application/ports.js").User} user
 */
export function publicUser(user) {
  return { id: user.id, network: user.network, account: user.account };
}

/**
 * @param {{ router: import("../../../platform/http/Router.js").Router, auth: import("../application/AuthService.js").AuthService, cookie: { name: string, secure: boolean }, clock: import("../../../kernel/time.js").Clock }} deps
 */
export function registerIdentityRoutes({ router, auth, cookie, clock }) {
  router.add({
    method: "POST",
    path: "/api/auth/challenges",
    rateLimit: AUTH_RATE,
    handler: async (context) => {
      const body = validated(await context.readJson(), CHALLENGE_KEYS, (issues, object) => {
        checkString(issues, object.account, "body.account", { minLength: 1, maxLength: 64 });
        if (object.network !== undefined) {
          checkString(issues, object.network, "body.network", { minLength: 1, maxLength: 16 });
        }
      });
      const challenge = await auth.issueChallenge({ account: body.account, network: body.network, origin: /** @type {string} */ (context.origin) });
      return { status: 201, body: challenge };
    },
  });

  router.add({
    method: "POST",
    path: "/api/auth/sessions",
    rateLimit: AUTH_RATE,
    handler: async (context) => {
      const body = validated(await context.readJson(), SESSION_KEYS, (issues, object) => {
        checkString(issues, object.challengeId, "body.challengeId", { minLength: 36, maxLength: 36 });
        checkString(issues, object.signature, "body.signature", { minLength: 1, maxLength: 256 });
      });
      const session = await auth.login({ challengeId: body.challengeId, signature: body.signature, origin: /** @type {string} */ (context.origin), ip: context.ip });
      const maxAgeSeconds = (session.expiresAt - clock.now()) / 1000;
      return {
        status: 201,
        body: { user: publicUser(session.user), expiresAt: session.expiresAt },
        cookies: [serializeCookie({ name: cookie.name, value: session.token, maxAgeSeconds, secure: cookie.secure })],
      };
    },
  });

  router.add({
    method: "DELETE",
    path: "/api/auth/sessions/current",
    auth: Auth.REQUIRED,
    handler: async (context) => {
      await auth.logout(context.principal, context.ip);
      return { status: 204, cookies: [serializeCookie({ name: cookie.name, value: "", maxAgeSeconds: 0, secure: cookie.secure })] };
    },
  });

  router.add({
    method: "GET",
    path: "/api/me",
    auth: Auth.REQUIRED,
    handler: async (context) => ({ status: 200, body: { user: publicUser(context.principal.user) } }),
  });

  router.add({
    method: "GET",
    path: "/api/wallet/balances",
    auth: Auth.REQUIRED,
    rateLimit: BALANCE_RATE,
    handler: async (context) => ({ status: 200, body: { account: context.principal.user.account, balances: await auth.balancesOf(context.principal.user) } }),
  });
}
