/**
 * The server's identity API as the client application sees it. Every method
 * resolves to a Result; transport failures are failures, never exceptions.
 *
 * @typedef {Readonly<{ id: string, network: string, account: string }>} SessionUser
 * @typedef {Readonly<{ challengeId: string, message: string, keyRole: string, expiresAt: number }>} LoginChallenge
 *
 * @typedef {object} AuthApi
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Ok<SessionUser | null> | import("@magic8/engine/shared/Result.js").Fail>} currentUser null when signed out
 * @property {(account: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<LoginChallenge> | import("@magic8/engine/shared/Result.js").Fail>} createChallenge
 * @property {(proof: { challengeId: string, signature: string }) => Promise<import("@magic8/engine/shared/Result.js").Ok<SessionUser> | import("@magic8/engine/shared/Result.js").Fail>} createSession
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Ok<null> | import("@magic8/engine/shared/Result.js").Fail>} deleteSession
 */

/** Failure codes produced by the client side of the API (the server adds its own). */
export const ApiFailure = Object.freeze({
  NETWORK: "NETWORK",
  UNAVAILABLE: "UNAVAILABLE",
  BAD_RESPONSE: "BAD_RESPONSE",
});

export const AUTH_API_METHODS = Object.freeze(["currentUser", "createChallenge", "createSession", "deleteSession"]);
