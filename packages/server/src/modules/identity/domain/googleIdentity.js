/**
 * What a Google sign-in proves (docs/tcg/29-google.md): the claims of the ID
 * token Google's token endpoint returned to the server itself, over TLS. A
 * token received that way needs no signature check (OpenID Connect Core
 * §3.1.3.7), but it must be for this client, current, and answer the nonce
 * this sign-in sent.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";

const ISSUERS = Object.freeze(["https://accounts.google.com", "accounts.google.com"]);
const SUB_PATTERN = /^[\x21-\x7e]{1,255}$/;
const MAX_EMAIL_LENGTH = 254;

/**
 * @typedef {Readonly<{ sub: string, email: string | null }>} GoogleIdentity
 *   `sub`: Google's stable id of the account; `email`: only when Google verified it
 */

/**
 * @param {unknown} claims the ID token's payload
 * @param {{ clientId: string, nonce: string, now: number }} expected
 * @returns {import("@magic8/engine/shared/Result.js").Ok<GoogleIdentity> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function verifiedGoogleIdentity(claims, { clientId, nonce, now }) {
  if (claims === null || typeof claims !== "object") {
    return fail("ID_TOKEN_INVALID", "the ID token has no claims");
  }
  const token = /** @type {Record<string, unknown>} */ (claims);
  const refusal = CHECKS.find(({ holds }) => !holds(token, { clientId, nonce, now }));
  if (refusal !== undefined) {
    return fail("ID_TOKEN_INVALID", refusal.otherwise);
  }
  const { email, email_verified: emailVerified } = token;
  const verifiedEmail = emailVerified === true && typeof email === "string" && email.length <= MAX_EMAIL_LENGTH ? email : null;
  return ok(Object.freeze({ sub: /** @type {string} */ (token.sub), email: verifiedEmail }));
}

/**
 * What an ID token must say, in order.
 * @type {readonly { holds: (token: Record<string, unknown>, expected: { clientId: string, nonce: string, now: number }) => boolean, otherwise: string }[]}
 */
const CHECKS = Object.freeze([
  { holds: ({ iss }) => typeof iss === "string" && ISSUERS.includes(iss), otherwise: "the ID token was not issued by Google" },
  { holds: ({ aud }, { clientId }) => aud === clientId || (Array.isArray(aud) && aud.includes(clientId)), otherwise: "the ID token is for another client" },
  { holds: ({ exp }, { now }) => typeof exp === "number" && exp * 1000 > now, otherwise: "the ID token has expired" },
  { holds: ({ nonce }, expected) => nonce === expected.nonce, otherwise: "the ID token answers another sign-in" },
  { holds: ({ sub }) => typeof sub === "string" && SUB_PATTERN.test(sub), otherwise: "the ID token names no account" },
]);
