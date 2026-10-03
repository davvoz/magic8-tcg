/**
 * The wallet everything else signs with — online games, the shop, the
 * player market: Steem Keychain or the player's own keys, whichever they
 * signed in with (IdentityState.method). A WalletConnector itself, so the
 * services that sign never know which one answers.
 */
import { SignInMethod } from "../identity/IdentityService.js";

/** @typedef {import("../ports/WalletConnector.contract.js").WalletConnector} WalletConnector */

/** @implements {WalletConnector} */
export class WalletSwitch {
  #identity;
  #keychain;
  #keys;

  /**
   * @param {{ identity: Pick<import("../identity/IdentityService.js").IdentityService, "state">, keychain: WalletConnector, keys: WalletConnector }} deps
   */
  constructor({ identity, keychain, keys }) {
    this.#identity = identity;
    this.#keychain = keychain;
    this.#keys = keys;
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

  #current() {
    return this.usesKeys ? this.#keys : this.#keychain;
  }
}
