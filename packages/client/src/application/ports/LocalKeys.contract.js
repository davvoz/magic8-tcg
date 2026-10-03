/**
 * The player's own STEEM keys, typed into this browser instead of held by
 * an extension (docs/tcg/20-chiavi.md).
 *
 * - The posting key signs in and signs everything ordinary (the login
 *   challenge, each online game's key). It is kept in this browser's
 *   storage, encrypted with a key stored next to it — a guard against a
 *   glance at the storage, not against whoever can read all of the
 *   browser's data — and loaded at start-up (`restore`).
 * - The active key moves funds. It is asked for only when a transfer needs
 *   it, checked against the account, and may be saved encrypted with a PIN
 *   that is never stored. Once unlocked it stays in memory until the page
 *   closes; it is never unlocked at start-up.
 *
 * Before a key is accepted, the chain says which of the account's
 * authorities it controls: a posting key must be one (and nothing more —
 * a key that can move funds is never stored without a PIN); an active key
 * must be one.
 *
 * Implementations are WalletConnectors too (signMessage with the posting
 * key, requestTransfer with the active key).
 *
 * @typedef {object} LocalKeys
 * @property {() => Promise<string | null>} restore loads the saved posting key into memory; resolves to its account
 * @property {string | null} account the account whose posting key is in memory
 * @property {(account: string, wif: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<undefined> | import("@magic8/engine/shared/Result.js").Fail>} usePostingKey
 *   checks the key against the account on the chain and holds it in memory (not saved yet)
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Ok<undefined> | import("@magic8/engine/shared/Result.js").Fail>} save saves the posting key in memory (encrypted)
 * @property {() => void} forget drops every key of the account, from memory and from storage
 */

export const KeyFailure = Object.freeze({
  /** Not a private key in WIF form ("5…", 51 characters). */
  INVALID_KEY: "KEY_INVALID",
  /** The key controls none of the account's authorities this asks for. */
  NOT_AUTHORIZED: "KEY_NOT_AUTHORIZED",
  /** A key that can move funds, typed where the posting key belongs. */
  TOO_POWERFUL: "KEY_TOO_POWERFUL",
  /** The PIN does not open the saved key. */
  WRONG_PIN: "KEY_WRONG_PIN",
  /** The PIN is too short to protect anything. */
  WEAK_PIN: "KEY_WEAK_PIN",
  /** The browser could not store or read the key. */
  STORAGE: "KEY_STORAGE",
});

export const LOCAL_KEYS_METHODS = Object.freeze(["restore", "usePostingKey", "save", "forget"]);

/** The shortest PIN that may protect a saved active key. */
export const MIN_PIN_LENGTH = 4;
