/**
 * Asks the player for their active key when a transfer needs it, and only
 * then (docs/tcg/20-chiavi.md). Whoever signs the transfer calls `ask`; the
 * screen the player is on shows the request (a modal) and answers through
 * `submitKey`, `submitPin`, `forgetSaved` or `cancel`. The asker checks the
 * answer and either `close`s the request or asks again with the reason.
 *
 * States: idle → asking ⇄ checking → idle. Screens subscribe to redraw.
 *
 * @typedef {Readonly<{ kind: "key", wif: string, pin: string | null }>
 *   | Readonly<{ kind: "pin", pin: string }>
 *   | Readonly<{ kind: "forget" }>} ActiveKeyAnswer
 *   `key`: the active key, saved with `pin` when there is one; `pin`: unlock the saved key; `forget`: drop the saved key, type it again
 * @typedef {Readonly<{ status: string, account: string | null, saved: boolean, error: Readonly<{ code: string, message: string }> | null }>} ActiveKeyState
 *   `saved`: a key protected by a PIN is saved for the account
 */

export const ActiveKeyStatus = Object.freeze({
  IDLE: "idle",
  ASKING: "asking",
  CHECKING: "checking",
});

const IDLE = Object.freeze({ status: ActiveKeyStatus.IDLE, account: null, saved: false, error: null });

export class ActiveKeyPrompt {
  /** @type {ActiveKeyState} */
  #state = IDLE;
  /** @type {((answer: ActiveKeyAnswer | null) => void) | null} */
  #resolve = null;
  /** @type {Set<(state: ActiveKeyState) => void>} */
  #listeners = new Set();

  get state() {
    return this.#state;
  }

  /**
   * @param {(state: ActiveKeyState) => void} listener
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Shows the request (again, with `error`, after a wrong answer) and waits
   * for the player. A request still open is cancelled first.
   * @param {{ account: string, saved: boolean, error?: { code: string, message: string } | null }} request
   * @returns {Promise<ActiveKeyAnswer | null>} null when the player cancelled
   */
  ask({ account, saved, error = null }) {
    this.#answer(null);
    return new Promise((resolve) => {
      this.#resolve = resolve;
      this.#set({ status: ActiveKeyStatus.ASKING, account, saved, error });
    });
  }

  /**
   * @param {string} wif
   * @param {string} pin empty to use the key without saving it
   */
  submitKey(wif, pin) {
    this.#answer(Object.freeze({ kind: "key", wif: String(wif).trim(), pin: String(pin).length === 0 ? null : String(pin) }));
  }

  /** @param {string} pin */
  submitPin(pin) {
    this.#answer(Object.freeze({ kind: "pin", pin: String(pin) }));
  }

  forgetSaved() {
    this.#answer(Object.freeze({ kind: "forget" }));
  }

  cancel() {
    if (this.#resolve !== null) {
      this.#answer(null);
      this.#set(IDLE);
    }
  }

  /** The answer was right: the request is over. */
  close() {
    this.#resolve = null;
    this.#set(IDLE);
  }

  /** @param {ActiveKeyAnswer | null} answer */
  #answer(answer) {
    const resolve = this.#resolve;
    if (resolve === null) {
      return;
    }
    this.#resolve = null;
    if (answer !== null) {
      this.#set({ ...this.#state, status: ActiveKeyStatus.CHECKING, error: null });
    }
    resolve(answer);
  }

  /** @param {ActiveKeyState} state */
  #set(state) {
    this.#state = Object.freeze({ ...state, error: state.error === null ? null : Object.freeze({ code: state.error.code, message: state.error.message }) });
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}
