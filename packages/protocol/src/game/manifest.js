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
 *
 * A second kind, `ack_keys`, names the public keys that sign the server's
 * acks to players (docs/tcg/11-ack-firmati.md), with the same rules.
 */
import { Issues, checkArrayOf, checkEnum, checkInteger, checkObject, checkString, checkUnique } from "@magic8/engine/shared/validation.js";
import { CanonicalJsonError, canonicalize, parseCanonical } from "../canonical/CanonicalJson.js";
import { ProtocolError } from "./ProtocolError.js";
import { ACCOUNT_PATTERN, LIMITS, OperationId, PROTOCOL_VERSION } from "./constants.js";

export const ManifestKind = Object.freeze({ BROADCASTERS: "broadcasters", ACK_KEYS: "ack_keys" });

/** A STEEM public key ("STM" + base58 of the compressed point and its checksum). */
export const PUBLIC_KEY_PATTERN = /^STM[1-9A-HJ-NP-Za-km-z]{45,55}$/;
const MAX_MEMBERS = 32;

/** Per kind: the payload's keys, the field listing the members, and how a member looks. */
const SCHEMAS = Object.freeze({
  [ManifestKind.BROADCASTERS]: Object.freeze({ keys: Object.freeze(["accounts", "from_block", "kind", "v"]), field: "accounts", pattern: ACCOUNT_PATTERN }),
  [ManifestKind.ACK_KEYS]: Object.freeze({ keys: Object.freeze(["from_block", "keys", "kind", "v"]), field: "keys", pattern: PUBLIC_KEY_PATTERN }),
});

/**
 * @typedef {Readonly<{ effectiveBlock: number, members: ReadonlySet<string> }>} ManifestEpoch
 * @typedef {Readonly<{ kind: string, members: readonly string[], fromBlock: number }>} ParsedManifest
 */

/**
 * @param {unknown} value
 * @returns {ParsedManifest | null}
 */
function parseManifestValue(value) {
  const kind = value !== null && typeof value === "object" ? /** @type {Record<string, unknown>} */ (value).kind : undefined;
  const schema = typeof kind === "string" && Object.hasOwn(SCHEMAS, kind) ? SCHEMAS[kind] : null;
  if (schema === null) {
    return null;
  }
  const issues = new Issues();
  const manifest = checkObject(issues, value, "manifest", schema.keys);
  if (manifest === undefined) {
    return null;
  }
  checkEnum(issues, manifest.kind, "manifest.kind", Object.values(ManifestKind));
  checkInteger(issues, manifest.v, "manifest.v", { min: PROTOCOL_VERSION, max: PROTOCOL_VERSION });
  const fromBlock = checkInteger(issues, manifest.from_block, "manifest.from_block", { min: 0 });
  const members = checkArrayOf(issues, manifest[schema.field], `manifest.${schema.field}`, {
    minLength: 0,
    maxLength: MAX_MEMBERS,
    item: (item, path) => checkString(issues, item, path, { pattern: schema.pattern }),
  });
  if (members !== undefined) {
    checkUnique(issues, members, `manifest.${schema.field}`, (member) => member);
  }
  if (!issues.isEmpty || members === undefined || fromBlock === undefined) {
    return null;
  }
  return Object.freeze({ kind: /** @type {string} */ (kind), members: Object.freeze(members), fromBlock });
}

/**
 * What the root's manifests of one kind authorise, block by block.
 * A new manifest of a kind replaces the previous list from its effective block.
 */
class ManifestRegistry {
  /** @type {readonly ManifestEpoch[]} sorted by effective block */
  #epochs;

  /** @param {readonly ManifestEpoch[]} epochs */
  constructor(epochs) {
    this.#epochs = Object.freeze([...epochs].sort((left, right) => left.effectiveBlock - right.effectiveBlock));
  }

  /**
   * @param {string} kind
   * @param {readonly import("./OperationDecoder.js").ChainOperation[]} operations any operations; only valid manifests of `kind` from `rootAccount` count
   * @param {string} rootAccount
   * @returns {{ epochs: ManifestEpoch[], rejected: number }} rejected: manifests that are malformed or not signed by the root's active authority
   */
  static epochsOf(kind, operations, rootAccount) {
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
      } else if (manifest.kind === kind) {
        epochs.push(Object.freeze({ effectiveBlock: Math.max(manifest.fromBlock, operation.blockNum), members: new Set(manifest.members) }));
      }
    }
    return { epochs, rejected };
  }

  /**
   * @param {string} member
   * @param {number} blockNum
   * @returns {boolean}
   */
  isAuthorized(member, blockNum) {
    let current = null;
    for (const epoch of this.#epochs) {
      if (epoch.effectiveBlock > blockNum) {
        break;
      }
      current = epoch;
    }
    return current !== null && current.members.has(member);
  }

  /** @returns {readonly string[]} every member ever authorised, sorted */
  members() {
    return Object.freeze([...new Set(this.#epochs.flatMap((epoch) => [...epoch.members]))].sort());
  }

  get isEmpty() {
    return this.#epochs.length === 0;
  }

  /** @returns {(member: string, blockNum: number) => boolean} */
  asPolicy() {
    return (member, blockNum) => this.isAuthorized(member, blockNum);
  }
}

/** Which accounts may sign game records at a given block. */
export class BroadcasterRegistry extends ManifestRegistry {
  /**
   * @param {readonly import("./OperationDecoder.js").ChainOperation[]} operations
   * @param {string} rootAccount
   * @returns {{ registry: BroadcasterRegistry, rejected: number }}
   */
  static fromOperations(operations, rootAccount) {
    const { epochs, rejected } = ManifestRegistry.epochsOf(ManifestKind.BROADCASTERS, operations, rootAccount);
    return { registry: new BroadcasterRegistry(epochs), rejected };
  }

  /** @returns {readonly string[]} every account ever authorised, sorted */
  accounts() {
    return this.members();
  }
}

/** Which public keys may sign the server's acks (docs/tcg/11-ack-firmati.md) at a given block. */
export class AckKeyRegistry extends ManifestRegistry {
  /**
   * @param {readonly import("./OperationDecoder.js").ChainOperation[]} operations
   * @param {string} rootAccount
   * @returns {{ registry: AckKeyRegistry, rejected: number }}
   */
  static fromOperations(operations, rootAccount) {
    const { epochs, rejected } = ManifestRegistry.epochsOf(ManifestKind.ACK_KEYS, operations, rootAccount);
    return { registry: new AckKeyRegistry(epochs), rejected };
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
  if (parseManifestValue(value) === null) {
    throw new ProtocolError("a manifest lists up to 32 distinct valid accounts and a non-negative block number");
  }
  return canonicalize(value);
}

/**
 * The `m8tcg_manifest` payload with which the root account names the keys
 * that sign the server's acks from a block on. An empty list revokes them all.
 * @param {{ keys: readonly string[], fromBlock: number }} manifest
 * @returns {string} canonical JSON
 */
export function ackKeysManifest({ keys, fromBlock }) {
  const value = { from_block: fromBlock, keys: [...keys].sort(), kind: ManifestKind.ACK_KEYS, v: PROTOCOL_VERSION };
  if (parseManifestValue(value) === null) {
    throw new ProtocolError("an ack-keys manifest lists up to 32 distinct STEEM public keys and a non-negative block number");
  }
  return canonicalize(value);
}

/**
 * @param {string} json
 */
function parseManifest(json) {
  try {
    return parseManifestValue(parseCanonical(json, { maxBytes: LIMITS.MAX_OPERATION_BYTES }));
  } catch (error) {
    if (error instanceof CanonicalJsonError) {
      return null;
    }
    throw error;
  }
}
