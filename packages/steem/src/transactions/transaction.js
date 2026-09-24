/**
 * STEEM transactions carrying `custom_json` operations: binary serialization
 * (the bytes the chain hashes and signs), transaction id, signature, and the
 * JSON form a node accepts in `condenser_api.broadcast_transaction`.
 *
 * Only what the game publishes is supported, on purpose: a `custom_json`
 * signed with posting authority (or active, for the manifest, which is
 * signed by Keychain and never here). Anything else is refused rather than
 * half-serialized.
 *
 * Layout (little endian, as the chain's fc::raw):
 *   ref_block_num u16 ‖ ref_block_prefix u32 ‖ expiration u32 (Unix seconds)
 *   ‖ varint(#ops) ‖ { varint(op id) ‖ op fields }* ‖ varint(#extensions = 0)
 *   custom_json (id 18): flat_set<account> required_auths ‖ flat_set<account> required_posting_auths ‖ string id ‖ string json
 *   string = varint(byte length) ‖ UTF-8 bytes; flat_set = varint(count) ‖ sorted items
 *
 * digest = sha256(chain_id ‖ bytes); txId = hex(sha256(bytes))[0..40].
 * Signatures are 65-byte compact (27 + 4 + recovery id ‖ r ‖ s) and must be
 * "canonical" (r and s without a high bit or a redundant zero byte), so
 * signing retries with fresh deterministic extra entropy until they are.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { isValidAccountName } from "../accountName.js";
import { encodePublicKey } from "../crypto/keys.js";

/** STEEM mainnet chain id: 32 zero bytes. */
export const STEEM_CHAIN_ID = new Uint8Array(32);

const CUSTOM_JSON_OPERATION = 18;
const MAX_CUSTOM_JSON_ID_LENGTH = 32;
const MAX_CUSTOM_JSON_BYTES = 8192;
/** STEEM_MAX_TIME_UNTIL_EXPIRATION */
export const MAX_EXPIRATION_SECONDS = 3600;
const COMPACT_HEADER = 27 + 4;
const MAX_SIGNING_ATTEMPTS = 64;
const TX_ID_HEX_LENGTH = 40;

const encoder = new TextEncoder();

/**
 * @typedef {Readonly<{ type: "custom_json", requiredAuths: readonly string[], requiredPostingAuths: readonly string[], id: string, json: string }>} CustomJsonOperation
 * @typedef {Readonly<{ refBlockNum: number, refBlockPrefix: number, expiration: number, operations: readonly CustomJsonOperation[] }>} UnsignedTransaction
 *   expiration in Unix seconds
 */

/** Growable little-endian byte writer. */
class ByteWriter {
  /** @type {number[]} */
  #bytes = [];

  /** @param {number} value */
  u8(value) {
    this.#bytes.push(value & 0xff);
  }

  /** @param {number} value */
  u16(value) {
    this.u8(value);
    this.u8(value >>> 8);
  }

  /** @param {number} value */
  u32(value) {
    this.u16(value & 0xffff);
    this.u16(value >>> 16);
  }

  /** @param {number} value unsigned, < 2^32 */
  varint(value) {
    let rest = value >>> 0;
    while (rest >= 0x80) {
      this.u8((rest & 0x7f) | 0x80);
      rest >>>= 7;
    }
    this.u8(rest);
  }

  /** @param {Uint8Array} bytes */
  raw(bytes) {
    for (const byte of bytes) {
      this.#bytes.push(byte);
    }
  }

  /** @param {string} text */
  string(text) {
    const bytes = encoder.encode(text);
    this.varint(bytes.length);
    this.raw(bytes);
  }

  toBytes() {
    return Uint8Array.from(this.#bytes);
  }
}

/**
 * @param {readonly string[]} accounts
 * @param {string} what
 */
function checkAccountSet(accounts, what) {
  if (!Array.isArray(accounts) || !accounts.every((account) => isValidAccountName(account))) {
    throw new TypeError(`${what}: expected valid account names`);
  }
  const sorted = [...accounts].sort();
  if (sorted.some((account, index) => index > 0 && account === sorted[index - 1])) {
    throw new TypeError(`${what}: duplicate account`);
  }
  return sorted;
}

/**
 * @param {CustomJsonOperation} operation
 */
function checkCustomJson(operation) {
  if (operation === null || typeof operation !== "object" || operation.type !== "custom_json") {
    throw new TypeError("only custom_json operations are supported");
  }
  const requiredAuths = checkAccountSet(operation.requiredAuths, "requiredAuths");
  const requiredPostingAuths = checkAccountSet(operation.requiredPostingAuths, "requiredPostingAuths");
  if (requiredAuths.length + requiredPostingAuths.length === 0) {
    throw new TypeError("custom_json needs at least one required authority");
  }
  if (typeof operation.id !== "string" || operation.id.length === 0 || operation.id.length > MAX_CUSTOM_JSON_ID_LENGTH) {
    throw new TypeError(`custom_json id: 1..${MAX_CUSTOM_JSON_ID_LENGTH} characters`);
  }
  if (typeof operation.json !== "string" || encoder.encode(operation.json).length > MAX_CUSTOM_JSON_BYTES) {
    throw new TypeError(`custom_json json: a string of at most ${MAX_CUSTOM_JSON_BYTES} bytes`);
  }
  return { requiredAuths, requiredPostingAuths };
}

/**
 * @param {UnsignedTransaction} transaction
 */
function checkHeader({ refBlockNum, refBlockPrefix, expiration, operations }) {
  if (!Number.isInteger(refBlockNum) || refBlockNum < 0 || refBlockNum > 0xffff) {
    throw new TypeError("refBlockNum: expected a uint16");
  }
  if (!Number.isInteger(refBlockPrefix) || refBlockPrefix < 0 || refBlockPrefix > 0xffffffff) {
    throw new TypeError("refBlockPrefix: expected a uint32");
  }
  if (!Number.isInteger(expiration) || expiration < 0 || expiration > 0xffffffff) {
    throw new TypeError("expiration: expected Unix seconds as a uint32");
  }
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new TypeError("a transaction needs at least one operation");
  }
}

/**
 * @param {UnsignedTransaction} transaction
 * @returns {Uint8Array}
 */
export function serializeTransaction(transaction) {
  checkHeader(transaction);
  const writer = new ByteWriter();
  writer.u16(transaction.refBlockNum);
  writer.u32(transaction.refBlockPrefix);
  writer.u32(transaction.expiration);
  writer.varint(transaction.operations.length);
  for (const operation of transaction.operations) {
    const { requiredAuths, requiredPostingAuths } = checkCustomJson(operation);
    writer.varint(CUSTOM_JSON_OPERATION);
    writer.varint(requiredAuths.length);
    requiredAuths.forEach((account) => writer.string(account));
    writer.varint(requiredPostingAuths.length);
    requiredPostingAuths.forEach((account) => writer.string(account));
    writer.string(operation.id);
    writer.string(operation.json);
  }
  writer.varint(0);
  return writer.toBytes();
}

/**
 * @param {Uint8Array} bytes
 */
const toHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * @param {Uint8Array} serialized
 * @returns {string} 40 hex characters
 */
export function transactionId(serialized) {
  return toHex(sha256(serialized)).slice(0, TX_ID_HEX_LENGTH);
}

/**
 * @param {Uint8Array} serialized
 * @param {Uint8Array} [chainId]
 */
export function transactionDigest(serialized, chainId = STEEM_CHAIN_ID) {
  const message = new Uint8Array(chainId.length + serialized.length);
  message.set(chainId, 0);
  message.set(serialized, chainId.length);
  return sha256(message);
}

/**
 * The chain accepts only signatures whose r and s have no high bit and no redundant leading zero.
 * @param {Uint8Array} compact 64 bytes r ‖ s
 */
export function isCanonicalSignature(compact) {
  const canonicalHalf = (offset) => (compact[offset] & 0x80) === 0 && !(compact[offset] === 0 && (compact[offset + 1] & 0x80) === 0);
  return canonicalHalf(0) && canonicalHalf(32);
}

/**
 * @param {Uint8Array} digest 32 bytes
 * @param {Uint8Array} privateKey 32 bytes
 * @returns {string} 130 hex characters
 */
export function signDigest(digest, privateKey) {
  for (let attempt = 1; attempt <= MAX_SIGNING_ATTEMPTS; attempt += 1) {
    const extraEntropy = sha256(Uint8Array.from([...digest, attempt]));
    const recovered = secp256k1.sign(digest, privateKey, { prehash: false, format: "recovered", extraEntropy });
    const compact = recovered.slice(1);
    if (isCanonicalSignature(compact)) {
      return toHex(Uint8Array.from([COMPACT_HEADER + recovered[0], ...compact]));
    }
  }
  throw new Error("could not produce a canonical signature");
}

/**
 * @param {number} seconds
 */
function chainTime(seconds) {
  return new Date(seconds * 1000).toISOString().slice(0, 19);
}

/**
 * The transaction as `condenser_api.broadcast_transaction` takes it.
 * @param {UnsignedTransaction} transaction
 * @param {readonly string[]} signatures
 */
export function toBroadcastJson(transaction, signatures) {
  return {
    ref_block_num: transaction.refBlockNum,
    ref_block_prefix: transaction.refBlockPrefix,
    expiration: chainTime(transaction.expiration),
    operations: transaction.operations.map((operation) => [
      "custom_json",
      { required_auths: [...operation.requiredAuths].sort(), required_posting_auths: [...operation.requiredPostingAuths].sort(), id: operation.id, json: operation.json },
    ]),
    extensions: [],
    signatures: [...signatures],
  };
}

/**
 * TaPoS reference to a recent block: the chain rejects the transaction on a fork that lacks that block.
 * @param {number} blockNum
 * @param {string} blockId 40 hex characters
 */
export function blockReference(blockNum, blockId) {
  if (!Number.isSafeInteger(blockNum) || blockNum < 1 || typeof blockId !== "string" || !/^[0-9a-f]{40}$/.test(blockId)) {
    throw new TypeError("blockReference: expected a block number and a 40-hex block id");
  }
  const prefix = Number.parseInt(blockId.slice(8, 16).match(/../g)?.reverse().join("") ?? "", 16);
  return Object.freeze({ refBlockNum: blockNum & 0xffff, refBlockPrefix: prefix });
}

/**
 * The inverse of toBroadcastJson for custom_json transactions (test chains, audits).
 * @param {any} json
 * @returns {{ transaction: UnsignedTransaction, signatures: readonly string[] }}
 */
export function fromBroadcastJson(json) {
  if (json === null || typeof json !== "object" || !Array.isArray(json.operations) || !Array.isArray(json.signatures) || typeof json.expiration !== "string") {
    throw new TypeError("not a broadcast transaction");
  }
  const expiration = Date.parse(`${json.expiration}Z`) / 1000;
  const operations = json.operations.map((pair) => {
    if (!Array.isArray(pair) || pair[0] !== "custom_json" || pair[1] === null || typeof pair[1] !== "object") {
      throw new TypeError("only custom_json operations are supported");
    }
    const data = pair[1];
    return { type: /** @type {const} */ ("custom_json"), requiredAuths: data.required_auths, requiredPostingAuths: data.required_posting_auths, id: data.id, json: data.json };
  });
  return { transaction: { refBlockNum: json.ref_block_num, refBlockPrefix: json.ref_block_prefix, expiration, operations }, signatures: json.signatures };
}

/**
 * The public keys that produced a transaction's signatures (null for a malformed one).
 * @param {Uint8Array} digest
 * @param {readonly string[]} signatures 130 hex characters each
 * @returns {(string | null)[]}
 */
export function recoverSignerKeys(digest, signatures) {
  return signatures.map((signatureHex) => {
    if (typeof signatureHex !== "string" || !/^[0-9a-f]{130}$/.test(signatureHex)) {
      return null;
    }
    const bytes = Uint8Array.from(signatureHex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
    const recovery = bytes[0] - COMPACT_HEADER;
    if (recovery < 0 || recovery > 3 || !isCanonicalSignature(bytes.subarray(1))) {
      return null;
    }
    try {
      const signature = secp256k1.Signature.fromBytes(bytes.slice(1), "compact").addRecoveryBit(recovery);
      return encodePublicKey(signature.recoverPublicKey(digest).toBytes(true));
    } catch {
      return null;
    }
  });
}
