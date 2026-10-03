/**
 * Who is signed in, and the sign-in flow: ask the server for a challenge,
 * have the wallet sign it, hand the signature back. The session itself lives
 * in an HttpOnly cookie the client cannot read; this service only tracks the
 * resulting user, and how they signed in (`method`): with Steem Keychain, or
 * with their own posting key typed here (docs/tcg/20-chiavi.md).
 *
 * A posting key is checked against the account on the chain before anything
 * is signed, and saved (encrypted) once the server accepted the sign-in. At
 * start-up it is loaded again; if the session has expired meanwhile, it signs
 * in again by itself. Signing out forgets the keys.
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

/** How the signed-in player signs: with the extension, or with their own keys. */
export const SignInMethod = Object.freeze({
  KEYCHAIN: "keychain",
  KEYS: "keys",
});

export const IdentityError = Object.freeze({
  BUSY: "BUSY",
  INVALID_ACCOUNT: "INVALID_ACCOUNT",
  KEYS_UNSUPPORTED: "KEYS_UNSUPPORTED",
});

/** Loose client-side check for early feedback; the server applies the real rules. */
const ACCOUNT_PATTERN = /^[a-z][a-z0-9.-]{2,15}$/;
/** Failures that say nothing about the key: the server or the chain could not be asked. */
const UNREACHABLE = Object.freeze([ApiFailure.NETWORK, ApiFailure.UNAVAILABLE, "CHAIN_UNAVAILABLE", "RATE_LIMITED"]);

/**
 * @typedef {Readonly<{ status: string, user: import("../ports/AuthApi.contract.js").SessionUser | null, method: string | null, error: Readonly<{ code: string, message: string }> | null }>} IdentityState
 *   `method`: one of SignInMethod while signed in, null otherwise
 */

/**
 * @typedef {import("../ports/LocalKeys.contract.js").LocalKeys & Pick<import("../ports/WalletConnector.contract.js").WalletConnector, "signMessage">} KeyWallet
 */

export class IdentityService {
  #api;
  #wallet;
  /** @type {KeyWallet | null} */
  #keys;
  /** @type {IdentityState} */
  #state = Object.freeze({ status: IdentityStatus.UNKNOWN, user: null, method: null, error: null });
  /** @type {Set<(state: IdentityState) => void>} */
  #listeners = new Set();

  /**
   * @param {{ api: import("../ports/AuthApi.contract.js").AuthApi, wallet: import("../ports/WalletConnector.contract.js").WalletConnector, keys?: KeyWallet }} deps
   *   `wallet`: Steem Keychain; `keys`: the player's own keys (absent: Keychain only)
   */
  constructor({ api, wallet, keys }) {
    this.#api = api;
    this.#wallet = wallet;
    this.#keys = keys ?? null;
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

  /** Whether players can sign in with their own posting key here. */
  get keysAvailable() {
    return this.#keys !== null;
  }

  /**
   * @param {(state: IdentityState) => void} listener
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Asks the server who we are (the session cookie survives reloads), with
   * the saved posting key loaded first: the session is the key's, or
   * Keychain's; with no session left, the key signs in again.
   */
  async restore() {
    const saved = this.#keys === null ? null : await this.#keys.restore();
    const result = await this.#api.currentUser();
    if (!result.ok) {
      const offline = result.error.code === ApiFailure.NETWORK || result.error.code === ApiFailure.UNAVAILABLE;
      this.#set({ status: offline ? IdentityStatus.OFFLINE : IdentityStatus.SIGNED_OUT, user: null, method: null, error: offline ? null : result.error });
      return this.#state;
    }
    const user = result.value;
    if (user === null) {
      if (saved !== null) {
        await this.#signInWithHeldKey(saved);
        return this.#state;
      }
      this.#set({ status: IdentityStatus.SIGNED_OUT, user: null, method: null, error: null });
      return this.#state;
    }
    if (saved !== null && saved !== user.account) {
      // A key of another account than the session's: it does not belong to whoever plays here now.
      this.#keys?.forget();
    }
    this.#set({ status: IdentityStatus.SIGNED_IN, user, method: saved === user.account ? SignInMethod.KEYS : SignInMethod.KEYCHAIN, error: null });
    return this.#state;
  }

  /**
   * Signs in with Steem Keychain.
   * @param {string} rawAccount as typed; normalised to lower case
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<import("../ports/AuthApi.contract.js").SessionUser> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async signIn(rawAccount) {
    const account = this.#startSignIn(rawAccount);
    if (!account.ok) {
      return account;
    }
    if (!this.#wallet.isAvailable()) {
      return this.#failSignIn(fail(WalletFailure.NOT_INSTALLED, `${this.#wallet.name} was not found in this browser`));
    }
    this.#set({ status: IdentityStatus.SIGNING_IN, user: null, method: null, error: null });
    const signedIn = await this.#authenticate(account.value, this.#wallet);
    if (!signedIn.ok) {
      return this.#failSignIn(signedIn);
    }
    // Keychain holds the keys now: none of a previous player stays behind.
    this.#keys?.forget();
    this.#set({ status: IdentityStatus.SIGNED_IN, user: signedIn.value, method: SignInMethod.KEYCHAIN, error: null });
    return signedIn;
  }

  /**
   * Signs in with the account's posting key, checked on the chain first,
   * then saved in this browser.
   * @param {string} rawAccount as typed; normalised to lower case
   * @param {string} wif the private posting key
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<import("../ports/AuthApi.contract.js").SessionUser> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async signInWithKey(rawAccount, wif) {
    const account = this.#startSignIn(rawAccount);
    if (!account.ok) {
      return account;
    }
    if (this.#keys === null) {
      return this.#failSignIn(fail(IdentityError.KEYS_UNSUPPORTED, "signing in with a key is not available here"));
    }
    this.#set({ status: IdentityStatus.SIGNING_IN, user: null, method: null, error: null });
    const accepted = await this.#keys.usePostingKey(account.value, wif);
    if (!accepted.ok) {
      this.#keys.forget();
      return this.#failSignIn(accepted);
    }
    const signedIn = await this.#authenticate(account.value, this.#keys);
    if (!signedIn.ok) {
      this.#keys.forget();
      return this.#failSignIn(signedIn);
    }
    const saved = await this.#keys.save();
    // Not saved (storage full or blocked): the key still works until the page closes.
    this.#set({ status: IdentityStatus.SIGNED_IN, user: signedIn.value, method: SignInMethod.KEYS, error: saved.ok ? null : saved.error });
    return signedIn;
  }

  async signOut() {
    const result = await this.#api.deleteSession();
    this.#keys?.forget();
    this.#set({ status: IdentityStatus.SIGNED_OUT, user: null, method: null, error: result.ok ? null : result.error });
    return result;
  }

  /**
   * The session expired but the saved posting key is still here: sign in
   * again with it. A key the chain no longer accepts is forgotten; one that
   * could not be checked (no network) stays for the next start.
   * @param {string} account
   */
  async #signInWithHeldKey(account) {
    const keys = /** @type {KeyWallet} */ (this.#keys);
    this.#set({ status: IdentityStatus.SIGNING_IN, user: null, method: null, error: null });
    const signedIn = await this.#authenticate(account, keys);
    if (!signedIn.ok) {
      if (!UNREACHABLE.includes(signedIn.error.code)) {
        keys.forget();
      }
      this.#failSignIn(signedIn);
      return;
    }
    this.#set({ status: IdentityStatus.SIGNED_IN, user: signedIn.value, method: SignInMethod.KEYS, error: null });
  }

  /**
   * @param {string} rawAccount
   * @returns {import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail}
   */
  #startSignIn(rawAccount) {
    if (this.#state.status === IdentityStatus.SIGNING_IN) {
      return fail(IdentityError.BUSY, "a sign-in is already in progress");
    }
    const account = String(rawAccount).trim().replace(/^@/, "").toLowerCase();
    if (!ACCOUNT_PATTERN.test(account)) {
      return this.#failSignIn(fail(IdentityError.INVALID_ACCOUNT, "enter a valid Steem account name"));
    }
    return ok(account);
  }

  /**
   * Challenge, signature, session.
   * @param {string} account
   * @param {Pick<import("../ports/WalletConnector.contract.js").WalletConnector, "signMessage">} signer
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<import("../ports/AuthApi.contract.js").SessionUser> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async #authenticate(account, signer) {
    const challenge = await this.#api.createChallenge(account);
    if (!challenge.ok) {
      return challenge;
    }
    const signature = await signer.signMessage({ account, message: challenge.value.message, keyRole: challenge.value.keyRole });
    if (!signature.ok) {
      return signature;
    }
    return this.#api.createSession({ challengeId: challenge.value.challengeId, signature: signature.value });
  }

  /** @param {import("@magic8/engine/shared/Result.js").Fail} failure */
  #failSignIn(failure) {
    this.#set({ status: IdentityStatus.SIGNED_OUT, user: null, method: null, error: failure.error });
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
