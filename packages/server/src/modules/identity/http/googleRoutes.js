/**
 * HTTP surface of signing in with Google (docs/tcg/29-google.md).
 *
 * - The sign-in is a top-level navigation: /start answers a redirect to
 *   Google, Google sends the browser to /callback, which answers a redirect
 *   back into the game. The cookie that remembers the sign-in is SameSite=Lax:
 *   a Strict one would not come back with Google's redirect.
 * - The callback never answers JSON: whatever happens, the browser lands in
 *   the game, which reads `?google=…` and shows the next step.
 * - /api/auth/options tells the client whether to show the Google button.
 */
import { checkString } from "@magic8/engine/shared/validation.js";
import { serializeCookie } from "../../../platform/http/cookies.js";
import { validated } from "../../../platform/http/validateBody.js";
import { FLOW_TTL_MS, GoogleFailure, GoogleOutcome, SIGNUP_TTL_MS } from "../application/GoogleSignIn.js";
import { publicUser } from "./identityRoutes.js";

/** Each step of a sign-in has its own bucket: one sign-in takes one of each. */
const START_RATE = Object.freeze({ name: "google-start", capacity: 10, refillPerSecond: 10 / 60, by: /** @type {const} */ ("ip") });
const CALLBACK_RATE = Object.freeze({ name: "google-callback", capacity: 10, refillPerSecond: 10 / 60, by: /** @type {const} */ ("ip") });
const ACCOUNT_RATE = Object.freeze({ name: "google-accounts", capacity: 10, refillPerSecond: 10 / 60, by: /** @type {const} */ ("ip") });
/** Checked while the player types a name. */
const NAME_RATE = Object.freeze({ name: "google-names", capacity: 30, refillPerSecond: 1, by: /** @type {const} */ ("ip") });
const ACCOUNT_KEYS = Object.freeze(["account"]);
const MAX_QUERY_VALUE = 2048;

/**
 * @param {{
 *   router: import("../../../platform/http/Router.js").Router,
 *   google: import("../application/GoogleSignIn.js").GoogleSignIn | null,
 *   cookie: { name: string, secure: boolean },
 *   clock: import("../../../kernel/time.js").Clock,
 *   logger: import("../../../kernel/logger.js").Logger,
 * }} deps `google`: null when signing in with Google is not offered; `cookie`: the session cookie
 */
export function registerGoogleRoutes({ router, google, cookie, clock, logger }) {
  router.add({
    method: "GET",
    path: "/api/auth/options",
    handler: async () => ({ status: 200, body: { google: google !== null } }),
  });
  if (google === null) {
    return;
  }
  const prefix = cookie.secure ? "__Host-" : "";
  const flowCookie = `${prefix}m8_google_flow`;
  const signupCookie = `${prefix}m8_google_signup`;
  const sessionCookie = (/** @type {{ token: string, expiresAt: number }} */ session) => serializeCookie({ name: cookie.name, value: session.token, maxAgeSeconds: (session.expiresAt - clock.now()) / 1000, secure: cookie.secure });
  const cleared = (/** @type {string} */ name, /** @type {"Strict" | "Lax"} */ sameSite) => serializeCookie({ name, value: "", maxAgeSeconds: 0, secure: cookie.secure, sameSite });

  router.add({
    method: "GET",
    path: "/api/auth/google/start",
    rateLimit: START_RATE,
    handler: async () => {
      const { location, flow } = google.start();
      return { status: 302, headers: { Location: location }, cookies: [serializeCookie({ name: flowCookie, value: flow, maxAgeSeconds: FLOW_TTL_MS / 1000, secure: cookie.secure, sameSite: "Lax" })] };
    },
  });

  router.add({
    method: "GET",
    path: "/api/auth/google/callback",
    rateLimit: CALLBACK_RATE,
    handler: async (context) => {
      const cookies = [cleared(flowCookie, "Lax")];
      let result;
      try {
        result = await google.complete({
          code: queryValue(context.query, "code"),
          state: queryValue(context.query, "state"),
          error: context.query.has("error") ? "error" : null,
          flow: context.cookies.get(flowCookie) ?? null,
          ip: context.ip,
        });
      } catch (error) {
        logger.error("Google sign-in failed", { error: error instanceof Error ? error.message : String(error) });
        return redirect(`/?google=error&reason=${GoogleFailure.FAILED}`, cookies);
      }
      switch (result.kind) {
        case GoogleOutcome.SIGNED_IN:
          return redirect("/", [...cookies, sessionCookie(result.session)]);
        case GoogleOutcome.EXISTING:
          return redirect(`/?google=existing&account=${encodeURIComponent(result.account)}`, cookies);
        case GoogleOutcome.NEW:
          return redirect("/?google=new", [...cookies, serializeCookie({ name: signupCookie, value: result.signup, maxAgeSeconds: SIGNUP_TTL_MS / 1000, secure: cookie.secure })]);
        default:
          return redirect(`/?google=error&reason=${encodeURIComponent(result.kind === GoogleOutcome.FAILED ? result.reason : GoogleFailure.FAILED)}`, cookies);
      }
    },
  });

  router.add({
    method: "GET",
    path: "/api/auth/google/names",
    rateLimit: NAME_RATE,
    handler: async (context) => {
      const name = queryValue(context.query, "name") ?? "";
      const status = await google.nameStatus({ signup: context.cookies.get(signupCookie) ?? null, name });
      return { status: 200, body: { name, ...status } };
    },
  });

  router.add({
    method: "POST",
    path: "/api/auth/google/accounts",
    rateLimit: ACCOUNT_RATE,
    handler: async (context) => {
      const body = validated(await context.readJson(), ACCOUNT_KEYS, (issues, object) => {
        checkString(issues, object.account, "body.account", { minLength: 1, maxLength: 16 });
      });
      const session = await google.createAccount({ signup: context.cookies.get(signupCookie) ?? null, account: body.account, ip: context.ip });
      return { status: 201, body: { user: publicUser(session.user), expiresAt: session.expiresAt }, cookies: [cleared(signupCookie, "Strict"), sessionCookie(session)] };
    },
  });
}

/**
 * @param {string} location
 * @param {readonly string[]} cookies
 */
function redirect(location, cookies) {
  return { status: 302, headers: { Location: location }, cookies };
}

/**
 * @param {URLSearchParams} query
 * @param {string} name
 */
function queryValue(query, name) {
  const value = query.get(name);
  return value === null || value.length > MAX_QUERY_VALUE ? null : value;
}
