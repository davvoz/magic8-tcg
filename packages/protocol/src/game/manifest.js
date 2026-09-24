/**
 * The protocol manifest (docs/tcg/03-game-blockchain-protocol.md §11): the
 * trust anchor a verifier needs besides the chain itself. Only the root
 * account's active authority may publish it; it says which broadcaster
 * accounts may sign game records from which block on.
 *
 * An authorisation takes effect at max(from_block, block of the manifest
 * operation): a manifest can never authorise records retroactively.
 * Publishing a new broadcaster list replaces the previous one from its
 * effective block, which is how a compromised key is revoked.
 */
import { Issues, checkArrayOf, checkEnum, checkInteger, checkObject, checkString, checkUnique } from "@magic8/engine/shared/validation.js";
import { CanonicalJsonError, canonicalize, parseCanonical } from "../canonical/CanonicalJson.js";
import { ProtocolError } from "./ProtocolError.js";
import { ACCOUNT_PATTERN, LIMITS, OperationId, PROTOCOL_VERSION } from "./constants.js";

export const ManifestKind = Object.freeze({ BROADCASTERS: "broadcasters" });

const BROADCASTERS_KEYS = Object.freeze(["accounts", "from_block", "kind", "v"]);
const MAX_BROADCASTERS = 32;

/**
 * @typedef {Readonly<{ effectiveBlock: number, accounts: ReadonlySet<string> }>} BroadcasterEpoch
 */

/**
 * @param {unknown} value
 * @returns {Readonly<{ accounts: readonly string[], fromBlock: number }> | null}
 */
function parseBroadcasters(value) {
  const issues = new Issues();
  const manifest = checkObject(issues, value, "manifest", BROADCASTERS_KEYS);
  if (manifest === undefined) {
    return null;
  }
  checkEnum(issues, manifest.kind, "manifest.kind", Object.values(ManifestKind));
  checkInteger(issues, manifest.v, "manifest.v", { min: PROTOCOL_VERSION, max: PROTOCOL_VERSION });
  const fromBlock = checkInteger(issues, manifest.from_block, "manifest.from_block", { min: 0 });
  const accounts = checkArrayOf(issues, manifest.accounts, "manifest.accounts", {
    minLength: 0,
    maxLength: MAX_BROADCASTERS,
    item: (item, path) => checkString(issues, item, path, { pattern: ACCOUNT_PATTERN }),
  });
  if (accounts !== undefined) {
    checkUnique(issues, accounts, "manifest.accounts", (account) => account);
  }
  if (!issues.isEmpty || accounts === undefined || fromBlock === undefined) {
    return null;
  }
  return Object.freeze({ accounts: Object.freeze(accounts), fromBlock });
}

/** Which accounts may sign game records at a given block, built from manifest operations. */
export class BroadcasterRegistry {
  /** @type {readonly BroadcasterEpoch[]} sorted by effective block */
  #epochs;

  /** @param {readonly BroadcasterEpoch[]} epochs */
  constructor(epochs) {
    this.#epochs = Object.freeze([...epochs].sort((left, right) => left.effectiveBlock - right.effectiveBlock));
  }

  /**
   * @param {readonly import("./OperationDecoder.js").ChainOperation[]} operations any operations; only valid manifests from `rootAccount` count
   * @param {string} rootAccount
   * @returns {{ registry: BroadcasterRegistry, rejected: number }}
   */
  static fromOperations(operations, rootAccount) {
    const epochs = [];
    let rejected = 0;
    const ordered = [...operations].sort((left, right) => left.blockNum - right.blockNum || left.opIndex - right.opIndex);
    for (const operation of ordered) {
      if (operation.id !== OperationId.MANIFEST) {
        continue;
      }
      const signedByRoot = operation.requiredPostingAuths.length === 0 && operation.requiredAuths.length === 1 && operation.requiredAuths[0] === rootAccount;
      const manifest = signedByRoot ? parseManifest(operation.json) : null;
      if (manifest === null) {
        rejected += 1;
        continue;
      }
      epochs.push(Object.freeze({ effectiveBlock: Math.max(manifest.fromBlock, operation.blockNum), accounts: new Set(manifest.accounts) }));
    }
    return { registry: new BroadcasterRegistry(epochs), rejected };
  }

  /**
   * @param {string} account
   * @param {number} blockNum
   * @returns {boolean}
   */
  isAuthorized(account, blockNum) {
    let current = null;
    for (const epoch of this.#epochs) {
      if (epoch.effectiveBlock > blockNum) {
        break;
      }
      current = epoch;
    }
    return current !== null && current.accounts.has(account);
  }

  /** @returns {readonly string[]} every account ever authorised, sorted */
  accounts() {
    return Object.freeze([...new Set(this.#epochs.flatMap((epoch) => [...epoch.accounts]))].sort());
  }

  get isEmpty() {
    return this.#epochs.length === 0;
  }

  /** The policy function expected by decodeGameOperation. */
  asPolicy() {
    return (/** @type {string} */ account, /** @type {number} */ blockNum) => this.isAuthorized(account, blockNum);
  }
}

/**
 * The `m8tcg_manifest` payload the root account publishes (with its active
 * key, from Keychain) to authorise a broadcaster pool from a block on.
 * An empty list revokes every broadcaster.
 * @param {{ accounts: readonly string[], fromBlock: number }} manifest
 * @returns {string} canonical JSON
 */
export function broadcastersManifest({ accounts, fromBlock }) {
  const value = { accounts: [...accounts].sort(), from_block: fromBlock, kind: ManifestKind.BROADCASTERS, v: PROTOCOL_VERSION };
  if (parseBroadcasters(value) === null) {
    throw new ProtocolError("a manifest lists up to 32 distinct valid accounts and a non-negative block number");
  }
  return canonicalize(value);
}

/**
 * @param {string} json
 */
function parseManifest(json) {
  try {
    return parseBroadcasters(parseCanonical(json, { maxBytes: LIMITS.MAX_OPERATION_BYTES }));
  } catch (error) {
    if (error instanceof CanonicalJsonError) {
      return null;
    }
    throw error;
  }
}
