/**
 * Who is signed in, and the sign-in flow: ask the server for a challenge,
 * have the wallet sign it, hand the signature back. The session itself lives
 * in an HttpOnly cookie the client cannot read; this service only tracks the
 * resulting user.
 *
 * States: unknown → (restore) → signed-out | signed-in | offline;
 *         signed-out → signing-in → signed-in | signed-out (with an error).
 * "offline" means no game server answered: offline practice still works.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../ports/AuthApi.contract.js";
import { WalletFailure } from "../ports/WalletConnector.contract.js";

export const IdentityStatus = Object.freeze({
  UNKNOWN: "unknown",
  OFFLINE: "offline",
  SIGNED_OUT: "signed-out",
  SIGNING_IN: "signing-in",
  SIGNED_IN: "signed-in",
});

export const IdentityError = Object.freeze({
  BUSY: "BUSY",
  INVALID_ACCOUNT: "INVALID_ACCOUNT",
});

/** Loose client-side check for early feedback; the server applies the real rules. */
const ACCOUNT_PATTERN = /^[a-z][a-z0-9.-]{2,15}$/;

/**
 * @typedef {Readonly<{ status: string, user: import("../ports/AuthApi.contract.js").SessionUser | null, error: Readonly<{ code: string, message: string }> | null }>} IdentityState
 */

export class IdentityService {
  #api;
  #wallet;
  /** @type {IdentityState} */
  #state = Object.freeze({ status: IdentityStatus.UNKNOWN, user: null, error: null });
  /** @type {Set<(state: IdentityState) => void>} */
  #listeners = new Set();

  /**
   * @param {{ api: import("../ports/AuthApi.contract.js").AuthApi, wallet: import("../ports/WalletConnector.contract.js").WalletConnector }} deps
   */
  constructor({ api, wallet }) {
    this.#api = api;
    this.#wallet = wallet;
  }

  get state() {
    return this.#state;
  }

  get walletName() {
    return this.#wallet.name;
  }

  get walletAvailable() {
    return this.#wallet.isAvailable();
  }

  /**
   * @param {(state: IdentityState) => void} listener
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Asks the server who we are (the session cookie survives reloads). */
  async restore() {
    const result = await this.#api.currentUser();
    if (!result.ok) {
      const offline = result.error.code === ApiFailure.NETWORK || result.error.code === ApiFailure.UNAVAILABLE;
      this.#set({ status: offline ? IdentityStatus.OFFLINE : IdentityStatus.SIGNED_OUT, user: null, error: offline ? null : result.error });
      return this.#state;
    }
    this.#set({ status: result.value === null ? IdentityStatus.SIGNED_OUT : IdentityStatus.SIGNED_IN, user: result.value, error: null });
    return this.#state;
  }

  /**
   * @param {string} rawAccount as typed; normalised to lower case
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<import("../ports/AuthApi.contract.js").SessionUser> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async signIn(rawAccount) {
    if (this.#state.status === IdentityStatus.SIGNING_IN) {
      return fail(IdentityError.BUSY, "a sign-in is already in progress");
    }
    const account = String(rawAccount).trim().replace(/^@/, "").toLowerCase();
    if (!ACCOUNT_PATTERN.test(account)) {
      return this.#failSignIn(fail(IdentityError.INVALID_ACCOUNT, "enter a valid Steem account name"));
    }
    if (!this.#wallet.isAvailable()) {
      return this.#failSignIn(fail(WalletFailure.NOT_INSTALLED, `${this.#wallet.name} was not found in this browser`));
    }
    this.#set({ status: IdentityStatus.SIGNING_IN, user: null, error: null });
    const challenge = await this.#api.createChallenge(account);
    if (!challenge.ok) {
      return this.#failSignIn(challenge);
    }
    const signature = await this.#wallet.signMessage({ account, message: challenge.value.message, keyRole: challenge.value.keyRole });
    if (!signature.ok) {
      return this.#failSignIn(signature);
    }
    const session = await this.#api.createSession({ challengeId: challenge.value.challengeId, signature: signature.value });
    if (!session.ok) {
      return this.#failSignIn(session);
    }
    this.#set({ status: IdentityStatus.SIGNED_IN, user: session.value, error: null });
    return ok(session.value);
  }

  async signOut() {
    const result = await this.#api.deleteSession();
    this.#set({ status: IdentityStatus.SIGNED_OUT, user: null, error: result.ok ? null : result.error });
    return result;
  }

  /** @param {import("@magic8/engine/shared/Result.js").Fail} failure */
  #failSignIn(failure) {
    this.#set({ status: IdentityStatus.SIGNED_OUT, user: null, error: failure.error });
    return failure;
  }

  /** @param {IdentityState} state */
  #set(state) {
    this.#state = Object.freeze({ ...state, error: state.error === null ? null : Object.freeze({ code: state.error.code, message: state.error.message }) });
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}
