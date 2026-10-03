/**
 * How the screens that take payments name the step where the player
 * approves a transfer: in Keychain, or with their own active key
 * (docs/tcg/20-chiavi.md), whichever they signed in with.
 */
import { SignInMethod } from "../../application/identity/IdentityService.js";

/**
 * @param {import("../../application/AppContext.js").AppContext} app
 * @returns {boolean} whether the player signs with their own keys
 */
export function signsWithKeys(app) {
  return app.identity?.state.method === SignInMethod.KEYS;
}

/**
 * "Approve the transfer in Keychain", or its equivalent with the player's keys.
 * @param {import("../../application/AppContext.js").AppContext} app
 */
export function approveTransferText(app) {
  return signsWithKeys(app) ? "Confirm the transfer with your active key" : "Approve the transfer in Keychain";
}

/**
 * Who shows the exact transfer before it is paid, as the start of a sentence's object: "… before anything is paid".
 * @param {import("../../application/AppContext.js").AppContext} app
 */
export function transferPreviewText(app) {
  return signsWithKeys(app) ? "you see the exact transfer and confirm it with your active key" : "Keychain shows the exact transfer";
}
