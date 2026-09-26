/**
 * WalletConnector for the Steem Keychain browser extension, which injects
 * `window.steem_keychain`. `requestSignBuffer` signs the login message and
 * `requestTransfer` pays an order; the user's keys never leave the
 * extension. We receive a signature or a transaction id, validated for shape
 * before it goes anywhere.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { WalletFailure } from "../../application/ports/WalletConnector.contract.js";

const SIGNATURE_PATTERN = /^[0-9a-f]{130}$/;
const TX_ID_PATTERN = /^[0-9a-f]{40}$/;
const AMOUNT_PATTERN = /^\d{1,15}\.\d{3}$/;
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_REASON_LENGTH = 200;

/**
 * @typedef {{
 *   requestSignBuffer: (account: string, message: string, keyRole: string, callback: (response: any) => void) => void,
 *   requestTransfer: (account: string, to: string, amount: string, memo: string, currency: string, callback: (response: any) => void, enforce: boolean) => void,
 * }} SteemKeychain
 */

export class KeychainWalletConnector {
  #locate;
  #timers;
  #timeoutMs;

  /**
   * @param {{ locate: () => unknown, timers: { setTimeout: (callback: () => void, ms: number) => unknown, clearTimeout: (id: any) => void }, timeoutMs?: number }} deps
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
    return this.#request((keychain, callback) => keychain.requestSignBuffer(account, message, keyRole, callback), interpretSignature);
  }

  /**
   * Pays exactly what the server's instructions say. `enforce` stops the
   * user from switching to another account in the extension: the server
   * only accepts payments from the buyer's own account.
   * @param {import("../../application/ports/WalletConnector.contract.js").TransferRequest} request
   */
  requestTransfer({ from, to, amount, asset, memo }) {
    if (!AMOUNT_PATTERN.test(amount)) {
      return Promise.resolve(fail(WalletFailure.BAD_RESPONSE, "the payment amount is not a 3-decimal amount"));
    }
    if (typeof (/** @type {any} */ (this.#locate())?.requestTransfer) !== "function") {
      return Promise.resolve(fail(WalletFailure.NOT_INSTALLED, "this version of Steem Keychain cannot send transfers"));
    }
    return this.#request((keychain, callback) => keychain.requestTransfer(from, to, amount, memo, asset, callback, true), interpretTransfer);
  }

  /**
   * @param {(keychain: SteemKeychain, callback: (response: any) => void) => void} invoke
   * @param {(response: any) => import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail} interpret
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  #request(invoke, interpret) {
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
        invoke(keychain, (response) => settle(interpret(response)));
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
 * @returns {import("@magic8/engine/shared/Result.js").Fail | null} the refusal, or null when Keychain succeeded
 */
function refusal(response) {
  if (response === null || typeof response !== "object" || response.success !== true) {
    const reason = typeof response?.message === "string" ? response.message.slice(0, MAX_REASON_LENGTH) : "the request was cancelled";
    return fail(WalletFailure.REJECTED, reason);
  }
  return null;
}

/**
 * A broadcast's result carries the transaction id (`id`; some versions `tx_id`).
 * @param {any} response
 */
function interpretTransfer(response) {
  const refused = refusal(response);
  if (refused !== null) {
    return refused;
  }
  const txId = response.result?.id ?? response.result?.tx_id;
  return typeof txId === "string" && TX_ID_PATTERN.test(txId) ? ok(txId) : fail(WalletFailure.BAD_RESPONSE, "Keychain did not return a transaction id");
}

/** @param {any} response */
function interpretSignature(response) {
  const refused = refusal(response);
  if (refused !== null) {
    return refused;
  }
  if (typeof response.result !== "string" || !SIGNATURE_PATTERN.test(response.result)) {
    return fail(WalletFailure.BAD_SIGNATURE, "Keychain returned an unexpected signature");
  }
  return ok(response.result);
}
