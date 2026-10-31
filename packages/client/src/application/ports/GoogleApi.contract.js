/**
 * The game server's side of signing in with Google (docs/tcg/29-google.md).
 * The sign-in itself is a full-page visit to the server, which sends the
 * browser to Google and back to the game with the outcome in the address
 * (readGoogleReturn); this API covers the rest: whether it is offered, and
 * choosing the new account's name.
 *
 * @typedef {Readonly<{ name: string, available: boolean, reason: "invalid" | "taken" | null }>} NameStatus
 *
 * @typedef {object} GoogleApi
 * @property {string} startPath where the browser goes to sign in with Google
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Ok<boolean> | import("@magic8/engine/shared/Result.js").Fail>} offered whether the server offers it
 * @property {(name: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<NameStatus> | import("@magic8/engine/shared/Result.js").Fail>} nameStatus
 * @property {(name: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<import("./AuthApi.contract.js").SessionUser> | import("@magic8/engine/shared/Result.js").Fail>} createAccount
 *   creates the account and opens its session (the server sets the cookie)
 */

export const GOOGLE_API_METHODS = Object.freeze(["offered", "nameStatus", "createAccount"]);
