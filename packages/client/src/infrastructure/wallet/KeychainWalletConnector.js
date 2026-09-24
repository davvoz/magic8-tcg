/**
 * WalletConnector for the Steem Keychain browser extension, which injects
 * `window.steem_keychain`. Only `requestSignBuffer` is used here: the user's
 * keys never leave the extension; we receive a signature, validated for shape
 * before it goes anywhere.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { WalletFailure } from "../../application/ports/WalletConnector.contract.js";

const SIGNATURE_PATTERN = /^[0-9a-f]{130}$/;
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_REASON_LENGTH = 200;

/**
 * @typedef {{ requestSignBuffer: (account: string, message: string, keyRole: string, callback: (response: any) => void) => void }} SteemKeychain
 */

export class KeychainWalletConnector {
  #locate;
  #timers;
  #timeoutMs;

  /**
   * @param {{ locate: () => unknown, timers: { setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout }, timeoutMs?: number }} deps
   *   `locate` returns the injected extension object (or undefined), read at call time because extensions inject late
   */
  constructor({ locate, timers, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.#locate = locate;
    this.#timers = timers;
    this.#timeoutMs = timeoutMs;
  }

  get name() {
    return "Steem Keychain";
  }

  isAvailable() {
    return this.#keychain() !== null;
  }

  /**
   * @param {{ account: string, message: string, keyRole: string }} request
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  signMessage({ account, message, keyRole }) {
    const keychain = this.#keychain();
    if (keychain === null) {
      return Promise.resolve(fail(WalletFailure.NOT_INSTALLED, "Steem Keychain was not found in this browser"));
    }
    return new Promise((resolve) => {
      let settled = false;
      const settle = (result) => {
        if (!settled) {
          settled = true;
          this.#timers.clearTimeout(timer);
          resolve(result);
        }
      };
      const timer = this.#timers.setTimeout(() => settle(fail(WalletFailure.TIMEOUT, "Keychain did not answer in time")), this.#timeoutMs);
      try {
        keychain.requestSignBuffer(account, message, keyRole, (response) => settle(interpret(response)));
      } catch {
        settle(fail(WalletFailure.REJECTED, "Keychain refused the request"));
      }
    });
  }

  /** @returns {SteemKeychain | null} */
  #keychain() {
    const candidate = /** @type {any} */ (this.#locate());
    return candidate !== null && typeof candidate === "object" && typeof candidate.requestSignBuffer === "function" ? candidate : null;
  }
}

/**
 * @param {any} response Keychain's callback payload: { success, result, message, error }
 */
function interpret(response) {
  if (response === null || typeof response !== "object" || response.success !== true) {
    const reason = typeof response?.message === "string" ? response.message.slice(0, MAX_REASON_LENGTH) : "the request was cancelled";
    return fail(WalletFailure.REJECTED, reason);
  }
  if (typeof response.result !== "string" || !SIGNATURE_PATTERN.test(response.result)) {
    return fail(WalletFailure.BAD_SIGNATURE, "Keychain returned an unexpected signature");
  }
  return ok(response.result);
}
