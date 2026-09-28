/**
 * Game protocol v2 (docs/tcg/12): the player authorises, with their wallet
 * (Keychain), the key this browser signs a game's moves with. That signature
 * is also how they accept the game: the server starts it only once both
 * players have given it.
 *
 * The rules this class keeps, so the player is never pestered:
 * - one wallet prompt at a time per game, and at most one the player did not
 *   ask for (`ask`, when the game is found or resumed after a reload);
 * - after a refusal nothing asks again on its own: only the player can
 *   (`retry`, e.g. when they try to make a move);
 * - once a game is closed (`close`: cancelled, over, left) an answer that
 *   comes back late for it is dropped: nothing is sent, the key is thrown away.
 */

/** Where a game's authorisation stands. */
export const AuthorizationState = Object.freeze({
  /** The wallet prompt is open. */
  ASKING: "asking",
  AUTHORIZED: "authorized",
  /** The player said no, the wallet timed out, or the server refused the signature. */
  REFUSED: "refused",
  /** No wallet or no signed-in account here: this browser cannot sign. */
  UNAVAILABLE: "unavailable",
  /** The game was closed while the prompt was open; its answer was dropped. */
  CLOSED: "closed",
});

/**
 * @typedef {Readonly<{ state: string, reason: string | null }>} Authorization
 * @typedef {(type: string, data: Readonly<Record<string, unknown>>) => Promise<import("@magic8/engine/shared/Result.js").Ok<any> | import("@magic8/engine/shared/Result.js").Fail>} Send
 */

export class SessionAuthorizer {
  #sessionKeys;
  #wallet;
  #send;
  /** @type {Map<string, Authorization>} */
  #states = new Map();
  /** @type {Map<string, Promise<Authorization>>} prompts open now */
  #pending = new Map();
  /** @type {Set<string>} games closed: nothing more is asked or sent for them */
  #closed = new Set();

  /**
   * @param {{
   *   sessionKeys: import("../ports/SessionKeys.contract.js").SessionKeys | null,
   *   wallet: Pick<import("../ports/WalletConnector.contract.js").WalletConnector, "signMessage"> | null,
   *   send: Send,
   * }} deps `send` delivers game.session to the server
   */
  constructor({ sessionKeys, wallet, send }) {
    this.#sessionKeys = sessionKeys;
    this.#wallet = wallet;
    this.#send = send;
  }

  /**
   * @param {string} gameId
   * @returns {Authorization | null} null: never asked
   */
  stateOf(gameId) {
    return this.#states.get(gameId) ?? null;
  }

  /**
   * Asks the player once, on its own initiative; afterwards it only reports
   * how that went (a refusal is not asked again: see `retry`).
   * @param {string} gameId
   * @param {string | null} account
   * @returns {Promise<Authorization>}
   */
  ask(gameId, account) {
    const known = this.#states.get(gameId);
    if (known !== undefined && known.state !== AuthorizationState.ASKING) {
      return Promise.resolve(known);
    }
    return this.#prompt(gameId, account);
  }

  /**
   * Asks again because the player wants to (unless it is already authorised or asking).
   * @param {string} gameId
   * @param {string | null} account
   * @returns {Promise<Authorization>}
   */
  retry(gameId, account) {
    const known = this.#states.get(gameId);
    if (known?.state === AuthorizationState.AUTHORIZED && this.#sessionKeys?.has(gameId) === true) {
      return Promise.resolve(known);
    }
    return this.#prompt(gameId, account);
  }

  /**
   * The game is over for this browser (cancelled, finished, left): its key is
   * thrown away and a prompt still open for it will be ignored.
   * @param {string} gameId
   */
  close(gameId) {
    this.#closed.add(gameId);
    this.#sessionKeys?.forget(gameId);
    this.#states.set(gameId, freeze(AuthorizationState.CLOSED, null));
  }

  /**
   * One prompt per game at a time: a second caller shares the open one.
   * @param {string} gameId
   * @param {string | null} account
   */
  #prompt(gameId, account) {
    if (this.#closed.has(gameId)) {
      return Promise.resolve(freeze(AuthorizationState.CLOSED, null));
    }
    const open = this.#pending.get(gameId);
    if (open !== undefined) {
      return open;
    }
    const prompt = this.#authorize(gameId, account).then((outcome) => {
      this.#pending.delete(gameId);
      if (!this.#closed.has(gameId)) {
        this.#states.set(gameId, outcome);
      }
      return this.#closed.has(gameId) ? freeze(AuthorizationState.CLOSED, null) : outcome;
    });
    this.#pending.set(gameId, prompt);
    this.#states.set(gameId, freeze(AuthorizationState.ASKING, null));
    return prompt;
  }

  /**
   * @param {string} gameId
   * @param {string | null} account
   * @returns {Promise<Authorization>}
   */
  async #authorize(gameId, account) {
    if (this.#sessionKeys === null || this.#wallet === null || account === null) {
      return freeze(AuthorizationState.UNAVAILABLE, "no wallet can sign for this game here");
    }
    const { key, authorizationText } = await this.#sessionKeys.create(gameId);
    const signed = await this.#wallet.signMessage({ account, message: authorizationText, keyRole: "Posting" });
    if (this.#closed.has(gameId)) {
      this.#sessionKeys.forget(gameId);
      return freeze(AuthorizationState.CLOSED, null);
    }
    if (!signed.ok) {
      this.#sessionKeys.forget(gameId);
      return freeze(AuthorizationState.REFUSED, signed.error.message);
    }
    const reply = await this.#send("game.session", { gameId, key, authorization: signed.value });
    if (!reply.ok || reply.value.t !== "game.session") {
      this.#sessionKeys.forget(gameId);
      const error = reply.ok ? reply.value.d : reply.error;
      return freeze(AuthorizationState.REFUSED, `the server refused it: ${error?.message ?? "unknown reason"}`);
    }
    return freeze(AuthorizationState.AUTHORIZED, null);
  }
}

/**
 * @param {string} state
 * @param {string | null} reason
 * @returns {Authorization}
 */
function freeze(state, reason) {
  return Object.freeze({ state, reason });
}
