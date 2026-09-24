/**
 * Turns `custom_json` operations observed on a chain into protocol records
 * (docs/tcg/03-game-blockchain-protocol.md §14 steps 1–3). Anyone can publish
 * an operation with our id, so the signer is checked against the broadcasters
 * authorised by the manifest at that block before anything else is read.
 *
 * Operations are network-agnostic DTOs; chain adapters produce them.
 */
import { CanonicalJsonError, canonicalize, parseCanonical } from "../canonical/CanonicalJson.js";
import { LIMITS, OperationId } from "./constants.js";
import { validateEnvelope } from "./schema.js";

/**
 * @typedef {Readonly<{
 *   network: string,
 *   txId: string,
 *   blockNum: number,
 *   opIndex: number,
 *   id: string,
 *   requiredAuths: readonly string[],
 *   requiredPostingAuths: readonly string[],
 *   json: string,
 * }>} ChainOperation
 *
 * @typedef {(account: string, blockNum: number) => boolean} BroadcasterPolicy
 *   true when `account` was an authorised broadcaster at `blockNum`
 */

export const RejectionReason = Object.freeze({
  WRONG_ID: "WRONG_ID",
  ACTIVE_AUTHORITY: "ACTIVE_AUTHORITY",
  SIGNER_COUNT: "SIGNER_COUNT",
  UNAUTHORIZED_SIGNER: "UNAUTHORIZED_SIGNER",
  NOT_CANONICAL: "NOT_CANONICAL",
  INVALID_ENVELOPE: "INVALID_ENVELOPE",
});

/**
 * @typedef {Readonly<{ ok: true, signer: string, records: readonly import("./GameHistory.js").ObservedRecord[] }>} DecodedOperation
 * @typedef {Readonly<{ ok: false, reason: string, message: string }>} RejectedOperation
 */

/**
 * @param {string} reason
 * @param {string} message
 * @returns {RejectedOperation}
 */
function reject(reason, message) {
  return Object.freeze({ ok: false, reason, message });
}

/**
 * @param {ChainOperation} operation
 * @param {BroadcasterPolicy} isAuthorizedBroadcaster
 * @returns {DecodedOperation | RejectedOperation}
 */
export function decodeGameOperation(operation, isAuthorizedBroadcaster) {
  if (operation.id !== OperationId.GAME) {
    return reject(RejectionReason.WRONG_ID, `unexpected custom_json id "${operation.id}"`);
  }
  if (operation.requiredAuths.length > 0) {
    return reject(RejectionReason.ACTIVE_AUTHORITY, "game records are signed with posting authority only");
  }
  if (operation.requiredPostingAuths.length !== 1) {
    return reject(RejectionReason.SIGNER_COUNT, "a game record operation has exactly one signer");
  }
  const signer = operation.requiredPostingAuths[0];
  if (!isAuthorizedBroadcaster(signer, operation.blockNum)) {
    return reject(RejectionReason.UNAUTHORIZED_SIGNER, `"${signer}" is not an authorised broadcaster at block ${operation.blockNum}`);
  }
  let parsed;
  try {
    parsed = parseCanonical(operation.json, { maxBytes: LIMITS.MAX_OPERATION_BYTES });
  } catch (error) {
    const message = error instanceof CanonicalJsonError ? error.message : "unreadable payload";
    return reject(RejectionReason.NOT_CANONICAL, message);
  }
  const envelope = validateEnvelope(parsed);
  if (!envelope.ok) {
    return reject(RejectionReason.INVALID_ENVELOPE, envelope.error.message);
  }
  const source = Object.freeze({ network: operation.network, txId: operation.txId, blockNum: operation.blockNum, opIndex: operation.opIndex, signer });
  const records = envelope.value.r.map((record) => Object.freeze({ record, json: canonicalize(record), source }));
  return Object.freeze({ ok: true, signer, records: Object.freeze(records) });
}
