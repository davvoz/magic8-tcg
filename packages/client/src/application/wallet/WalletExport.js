/**
 * Export wallet (docs/tcg/29-google.md): a player who signed in with Google
 * takes the keys of the account KIJAM keeps for them, to use it anywhere.
 *
 * The server hands them over only after the player signed in at Google
 * again in the last ten minutes. So `open` asks for them, and when the
 * server wants that sign-in, sends the browser to Google (`reauthenticate`):
 * the page comes back with "?google=export", and `resume` asks again, once.
 *
 * States: idle → opening → shown | failed → idle (close). Screens subscribe
 * to show the wallet; `copy` and `download` hand it to the device. The keys
 * live here only while shown.
 */
import { fail } from "@magic8/engine/shared/Result.js";

export const WalletExportStatus = Object.freeze({ IDLE: "idle", OPENING: "opening", SHOWN: "shown", FAILED: "failed" });
const REAUTH_REQUIRED = "REAUTH_REQUIRED";

/**
 * @typedef {Readonly<{ account: string, masterPassword: string, owner: string, active: string, posting: string, memo: string }>} ExportedWallet
 * @typedef {Readonly<{ status: string, wallet: ExportedWallet | null, error: Readonly<{ code: string, message: string }> | null }>} WalletExportState
 */

const IDLE = Object.freeze({ status: WalletExportStatus.IDLE, wallet: null, error: null });

export class WalletExport {
  #api;
  #reauthenticate;
  #clipboard;
  #files;
  /** @type {WalletExportState} */
  #state = IDLE;
  /** @type {Set<(state: WalletExportState) => void>} */
  #listeners = new Set();

  /**
   * @param {{
   *   api: { exportWallet: () => Promise<import("@magic8/engine/shared/Result.js").Ok<ExportedWallet> | import("@magic8/engine/shared/Result.js").Fail> },
   *   reauthenticate: () => void,
   *   clipboard: import("../ports/DeviceFiles.contract.js").Clipboard,
   *   files: import("../ports/DeviceFiles.contract.js").FileSaver,
   * }} deps `reauthenticate`: off to Google to sign in again (the page goes)
   */
  constructor({ api, reauthenticate, clipboard, files }) {
    this.#api = api;
    this.#reauthenticate = reauthenticate;
    this.#clipboard = clipboard;
    this.#files = files;
  }

  get state() {
    return this.#state;
  }

  /**
   * @param {(state: WalletExportState) => void} listener
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The player asked for their wallet: shown, or off to Google first. */
  open() {
    return this.#ask(true);
  }

  /** Back from signing in at Google again: the wallet, or why not (never Google a second time). */
  resume() {
    return this.#ask(false);
  }

  close() {
    this.#set(IDLE);
  }

  /**
   * @param {string} text one of the shown wallet's keys, or its password
   */
  copy(text) {
    return this.#clipboard.write(text);
  }

  /** Saves the shown wallet as a text file. */
  download() {
    const { wallet } = this.#state;
    if (wallet === null) {
      return fail("NOTHING_SHOWN", "there is no wallet to save");
    }
    return this.#files.save(walletFileName(wallet), walletFileText(wallet));
  }

  /** @param {boolean} mayReauthenticate */
  async #ask(mayReauthenticate) {
    if (this.#state.status === WalletExportStatus.OPENING) {
      return;
    }
    this.#set({ status: WalletExportStatus.OPENING, wallet: null, error: null });
    const exported = await this.#api.exportWallet();
    if (exported.ok) {
      this.#set({ status: WalletExportStatus.SHOWN, wallet: exported.value, error: null });
      return;
    }
    if (exported.error.code === REAUTH_REQUIRED && mayReauthenticate) {
      // The page goes to Google and comes back: it stays "opening" until then.
      this.#reauthenticate();
      return;
    }
    this.#set({ status: WalletExportStatus.FAILED, wallet: null, error: exported.error });
  }

  /** @param {WalletExportState} state */
  #set(state) {
    this.#state = Object.freeze({ ...state, error: state.error === null ? null : Object.freeze({ code: state.error.code, message: state.error.message }) });
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}

/** @param {ExportedWallet} wallet */
export function walletFileName(wallet) {
  return `kijam-wallet-${wallet.account}.txt`;
}

/**
 * The saved file: everything to use the account anywhere, and what to keep in mind.
 * @param {ExportedWallet} wallet
 */
export function walletFileText({ account, masterPassword, owner, active, posting, memo }) {
  return [
    `KIJAM wallet of @${account}`,
    "",
    "Keep this file private: anyone who reads it controls your account and its STEEM.",
    "",
    `Account: ${account}`,
    `Master password: ${masterPassword}`,
    `Owner key: ${owner}`,
    `Active key: ${active}`,
    `Posting key: ${posting}`,
    `Memo key: ${memo}`,
    "",
    "Sign in to KIJAM or any Steem app with the posting key. The active key moves your STEEM; the owner key and the",
    "master password change all the keys: keep those two offline.",
    "",
  ].join("\n");
}
