/**
 * The wallet everything else signs with — online games, the shop, the
 * player market: Steem Keychain, the player's own keys, or the wallet KIJAM
 * keeps (a Google sign-in), whichever they signed in with
 * (IdentityState.method). A WalletConnector itself, so the services that
 * sign never know which one answers.
 *
 * Strictly the one they signed in with, never another as a fallback: a
 * Keychain player pays in Keychain; a posting-key player pays with their
 * active key, asked for the first time a payment needs it; a Google player
 * pays from the wallet KIJAM keeps, even if the account is one whose keys
 * this browser also holds.
 */
import { SignInMethod } from "../identity/IdentityService.js";

/** @typedef {import("../ports/WalletConnector.contract.js").WalletConnector} WalletConnector */

/** @implements {WalletConnector} */
export class WalletSwitch {
  #identity;
  #keychain;
  #keys;
  #custodial;

  /**
   * @param {{ identity: Pick<import("../identity/IdentityService.js").IdentityService, "state">, keychain: WalletConnector, keys: WalletConnector, custodial: WalletConnector }} deps
   */
  constructor({ identity, keychain, keys, custodial }) {
    this.#identity = identity;
    this.#keychain = keychain;
    this.#keys = keys;
    this.#custodial = custodial;
  }

  /** Whether the player signs with their own keys (rather than Keychain). */
  get usesKeys() {
    return this.#identity.state.method === SignInMethod.KEYS;
  }

  get name() {
    return this.#current().name;
  }

  isAvailable() {
    return this.#current().isAvailable();
  }

  /** @param {{ account: string, message: string, keyRole: string }} request */
  signMessage(request) {
    return this.#current().signMessage(request);
  }

  /** @param {import("../ports/WalletConnector.contract.js").TransferRequest} request */
  requestTransfer(request) {
    return this.#current().requestTransfer(request);
  }

  /** @param {import("../ports/WalletConnector.contract.js").CommentRequest} request */
  postComment(request) {
    return this.#current().postComment(request);
  }

  #current() {
    switch (this.#identity.state.method) {
      case SignInMethod.KEYS:
        return this.#keys;
      case SignInMethod.GOOGLE:
        return this.#custodial;
      default:
        return this.#keychain;
    }
  }
}
