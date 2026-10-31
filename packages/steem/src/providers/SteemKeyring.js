/**
 * The keys of an account a server keeps for its player (docs/tcg/29-google.md):
 * what the server's custody needs to know of STEEM keys, without knowing STEEM.
 *
 * It signs what the player's browser signs with their own keys
 * (LocalKeyWallet): a message (a game's session key, 12), a transfer that
 * pays an order, a comment (a ping, 26). The transaction it returns is in the
 * node's JSON form, ready for the same relay the browser's go through.
 */
import { isValidAccountName } from "../accountName.js";
import { parseSteemAsset } from "../assets.js";
import { decodeWif, publicKeyOf, signMessage } from "../crypto/keys.js";
import { blockReference, serializeTransaction, signDigest, toBroadcastJson, transactionDigest, transactionId } from "../transactions/transaction.js";
import { STEEM_NETWORK } from "./SteemBlockchainProvider.js";

const AMOUNT_PATTERN = /^\d{1,15}\.\d{3}$/;

/**
 * @typedef {Readonly<{ blockNum: number, blockId: string, time: number }>} BlockReference the head block, its time in ms
 * @typedef {Readonly<{ from: string, to: string, amount: string, asset: string, memo: string }>} TransferRequest amount as "1.000"
 * @typedef {Readonly<{ author: string, parentAuthor: string, parentPermlink: string, permlink: string, title: string, body: string, jsonMetadata: string }>} CommentRequest
 */

export class SteemKeyring {
  get network() {
    return STEEM_NETWORK;
  }

  /**
   * @param {string} wif a private key in wallet import format
   * @returns {string | null} its public key ("STM…"), or null when it is not a private key
   */
  publicKeyOf(wif) {
    const key = typeof wif === "string" ? decodeWif(wif) : null;
    return key === null ? null : publicKeyOf(key);
  }

  /**
   * Signs like Keychain's signBuffer.
   * @param {string} message
   * @param {string} wif
   * @returns {string} the signature, hex
   */
  signMessage(message, wif) {
    return signMessage(message, keyOf(wif));
  }

  /**
   * @param {{ reference: BlockReference, expirationSeconds: number, transfer: TransferRequest }} request
   * @param {string} wif the active key of `transfer.from`
   * @returns {Readonly<{ transaction: Readonly<Record<string, unknown>>, txId: string }>}
   */
  signTransfer({ reference, expirationSeconds, transfer }, wif) {
    const { from, to, amount, asset, memo } = transfer;
    const parsed = AMOUNT_PATTERN.test(amount) ? parseSteemAsset(`${amount} ${asset}`) : null;
    if (parsed === null || !isValidAccountName(from) || !isValidAccountName(to) || typeof memo !== "string") {
      throw new TypeError("SteemKeyring: not a transfer of STEEM or SBD between two accounts");
    }
    const operation = { type: /** @type {const} */ ("transfer"), from, to, amount: parsed.amount, asset: parsed.asset, memo };
    return sign(reference, expirationSeconds, operation, wif);
  }

  /**
   * @param {{ reference: BlockReference, expirationSeconds: number, comment: CommentRequest }} request
   * @param {string} wif the posting key of `comment.author`
   * @returns {Readonly<{ transaction: Readonly<Record<string, unknown>>, txId: string }>}
   */
  signComment({ reference, expirationSeconds, comment }, wif) {
    const { author, parentAuthor, parentPermlink, permlink, title, body, jsonMetadata } = comment;
    const operation = { type: /** @type {const} */ ("comment"), parentAuthor, parentPermlink, author, permlink, title, body, jsonMetadata };
    return sign(reference, expirationSeconds, operation, wif);
  }
}

/**
 * @param {string} wif
 * @returns {Uint8Array}
 */
function keyOf(wif) {
  const key = typeof wif === "string" ? decodeWif(wif) : null;
  if (key === null) {
    throw new TypeError("SteemKeyring: not a private key");
  }
  return key;
}

/**
 * @param {BlockReference} reference
 * @param {number} expirationSeconds
 * @param {any} operation
 * @param {string} wif
 */
function sign({ blockNum, blockId, time }, expirationSeconds, operation, wif) {
  const transaction = { ...blockReference(blockNum, blockId), expiration: Math.floor(time / 1000) + expirationSeconds, operations: [operation] };
  const bytes = serializeTransaction(transaction);
  return Object.freeze({ transaction: toBroadcastJson(transaction, [signDigest(transactionDigest(bytes), keyOf(wif))]), txId: transactionId(bytes) });
}
