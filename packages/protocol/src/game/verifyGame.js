/**
 * Facade of the verification pipeline: chain operations in, verdict out.
 *
 *   decode (signer, canonical JSON, schema)
 *   → assemble (duplicates, gaps, forks, chain, lifecycle)
 *   → signatures (v2: every player move signed by the seat's session key)
 *   → replay (reveals, engine, checkpoints, outcome)
 */
import { assembleGameHistory, HistoryStatus } from "./GameHistory.js";
import { decodeGameOperation } from "./OperationDecoder.js";
import { ReplayStatus, replayGame } from "./ReplayVerifier.js";
import { SignatureStatus, checkMoveSignatures } from "./sessions.js";

export const Verdict = Object.freeze({
  VALID: "VALID",
  IN_PROGRESS: "IN_PROGRESS",
  INVALID: "INVALID",
});

/**
 * @param {{
 *   gameId: string,
 *   operations: readonly import("./OperationDecoder.js").ChainOperation[],
 *   isAuthorizedBroadcaster: import("./OperationDecoder.js").BroadcasterPolicy,
 *   resolveContent: import("./ReplayVerifier.js").ContentResolver,
 *   verifyMoveSignature?: import("./sessions.js").MoveSignatureVerifier,
 * }} input `verifyMoveSignature` is required for v2 games
 */
export function verifyGame({ gameId, operations, isAuthorizedBroadcaster, resolveContent, verifyMoveSignature }) {
  const records = [];
  const rejected = [];
  for (const operation of operations) {
    const decoded = decodeGameOperation(operation, isAuthorizedBroadcaster);
    if (decoded.ok) {
      records.push(...decoded.records);
    } else {
      rejected.push(Object.freeze({ txId: operation.txId, reason: decoded.reason, message: decoded.message }));
    }
  }
  const history = assembleGameHistory(gameId, records);
  const signatures = checkMoveSignatures(history, verifyMoveSignature);
  const replay = history.status === HistoryStatus.COMPLETE ? replayGame(history, resolveContent) : null;
  return Object.freeze({ verdict: verdictOf(history, replay, signatures), history, signatures, replay, rejected: Object.freeze(rejected) });
}

/** @type {ReadonlySet<string>} */
const SIGNED = new Set([SignatureStatus.NOT_REQUIRED, SignatureStatus.VALID]);

/**
 * @param {import("./GameHistory.js").GameHistory} history
 * @param {import("./ReplayVerifier.js").ReplayResult | null} replay
 * @param {{ status: string }} signatures
 */
function verdictOf(history, replay, signatures) {
  if (!SIGNED.has(signatures.status)) {
    return Verdict.INVALID;
  }
  if (history.status === HistoryStatus.IN_PROGRESS) {
    return Verdict.IN_PROGRESS;
  }
  return replay !== null && replay.status === ReplayStatus.VALID ? Verdict.VALID : Verdict.INVALID;
}
