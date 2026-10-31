/**
 * How the screens that take payments name the step where the player
 * approves a transfer: in Keychain, with their own active key
 * (docs/tcg/20-chiavi.md), or not at all with the wallet KIJAM keeps
 * (docs/tcg/29-google.md), whichever they signed in with.
 */
import { SignInMethod } from "../../application/identity/IdentityService.js";

const APPROVE_NOTE = "Nothing is paid until you approve it.";

/** What each way of signing says at the payment step of a purchase: its title, and the note under it. */
const APPROVAL = Object.freeze({
  [SignInMethod.KEYCHAIN]: Object.freeze({ approve: "Approve the transfer in Keychain", approveNote: APPROVE_NOTE }),
  [SignInMethod.KEYS]: Object.freeze({ approve: "Confirm the transfer with your active key", approveNote: APPROVE_NOTE }),
  [SignInMethod.GOOGLE]: Object.freeze({ approve: "Paying from your KIJAM wallet…", approveNote: "Your KIJAM wallet pays exactly this, nothing more." }),
});

/** Who shows the exact transfer before it is paid, as the start of a sentence's object: "… before anything is paid". */
const PREVIEW = Object.freeze({
  [SignInMethod.KEYCHAIN]: "Keychain shows the exact transfer",
  [SignInMethod.KEYS]: "you see the exact transfer and confirm it with your active key",
  [SignInMethod.GOOGLE]: "you see the exact price",
});

/**
 * @param {import("../../application/AppContext.js").AppContext} app
 * @returns {string} a SignInMethod: Keychain when signed out
 */
function methodOf(app) {
  return app.identity?.state.method ?? SignInMethod.KEYCHAIN;
}

/**
 * @param {import("../../application/AppContext.js").AppContext} app
 * @returns {boolean} whether the player signs with their own keys
 */
export function signsWithKeys(app) {
  return methodOf(app) === SignInMethod.KEYS;
}

/**
 * The payment step of a purchase tracker: "Approve the transfer in Keychain", or its equivalent.
 * @param {import("../../application/AppContext.js").AppContext} app
 * @returns {Readonly<{ approve: string, approveNote: string }>}
 */
export function approvalWords(app) {
  return APPROVAL[/** @type {keyof typeof APPROVAL} */ (methodOf(app))] ?? APPROVAL[SignInMethod.KEYCHAIN];
}

/**
 * Who shows the exact transfer before it is paid, as the start of a sentence's object: "… before anything is paid".
 * @param {import("../../application/AppContext.js").AppContext} app
 */
export function transferPreviewText(app) {
  return PREVIEW[/** @type {keyof typeof PREVIEW} */ (methodOf(app))] ?? PREVIEW[SignInMethod.KEYCHAIN];
}
