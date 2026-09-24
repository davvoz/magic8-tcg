/**
 * Minimal string store the repositories are written against. Implemented by
 * LocalStorageStore (browser) and InMemoryStore (tests, fallback).
 *
 * @typedef {object} KeyValueStore
 * @property {(key: string) => import("@magic8/engine/shared/Result.js").Ok<string | null> | import("@magic8/engine/shared/Result.js").Fail} read
 * @property {(key: string, value: string) => import("@magic8/engine/shared/Result.js").Ok<undefined> | import("@magic8/engine/shared/Result.js").Fail} write
 * @property {(key: string) => import("@magic8/engine/shared/Result.js").Ok<undefined> | import("@magic8/engine/shared/Result.js").Fail} delete
 */

export const KEY_VALUE_STORE_METHODS = Object.freeze(["read", "write", "delete"]);

export const StoreError = Object.freeze({
  UNAVAILABLE: "STORE_UNAVAILABLE",
  WRITE_FAILED: "STORE_WRITE_FAILED",
});
