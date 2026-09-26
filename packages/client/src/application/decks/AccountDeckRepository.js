/**
 * Which decks the player is working with: their account's decks while
 * signed in (the server checks ownership and keeps them across devices),
 * the browser's own decks otherwise (offline practice). The deck services
 * depend on this one repository and never ask which is behind it.
 */
import { IdentityStatus } from "../identity/IdentityService.js";

export const DeckStorage = Object.freeze({ ACCOUNT: "account", BROWSER: "browser" });

/** @typedef {import("../ports/DeckRepository.contract.js").DeckRepository} DeckRepository */

/** @implements {DeckRepository} */
export class AccountDeckRepository {
  #identity;
  #account;
  #browser;

  /**
   * @param {{
   *   identity: { state: import("../identity/IdentityService.js").IdentityState } | undefined,
   *   account: import("../ports/DeckRepository.contract.js").DeckRepository,
   *   browser: import("../ports/DeckRepository.contract.js").DeckRepository,
   * }} deps
   */
  constructor({ identity, account, browser }) {
    this.#identity = identity;
    this.#account = account;
    this.#browser = browser;
  }

  /** @returns {"account" | "browser"} */
  get storage() {
    return this.#identity?.state.status === IdentityStatus.SIGNED_IN ? DeckStorage.ACCOUNT : DeckStorage.BROWSER;
  }

  list() {
    return this.#active().list();
  }

  /** @param {import("@magic8/engine/domain/decks/DeckList.js").DeckList} deck */
  save(deck) {
    return this.#active().save(deck);
  }

  /** @param {string} deckId */
  remove(deckId) {
    return this.#active().remove(deckId);
  }

  #active() {
    return this.storage === DeckStorage.ACCOUNT ? this.#account : this.#browser;
  }
}
