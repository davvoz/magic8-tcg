/**
 * Port for remembering how the player signed in on this browser — with
 * Steem Keychain or with their own posting key — across reloads. The
 * session cookie survives a reload but says nothing of the wallet: without
 * this, a session whose posting key this browser no longer holds would be
 * taken for a Keychain one. Implemented by StoredSignIn (this browser's
 * storage); what it reads back is checked there.
 *
 * @typedef {Readonly<{ account: string, method: string }>} SignInEntry `method`: a SignInMethod
 * @typedef {object} SignInRecord
 * @property {() => SignInEntry | null} read the last sign-in remembered, or null
 * @property {(entry: SignInEntry) => void} write
 * @property {() => void} clear
 */

export const SIGN_IN_RECORD_METHODS = Object.freeze(["read", "write", "clear"]);
