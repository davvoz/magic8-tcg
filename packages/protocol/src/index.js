/**
 * Public API of @magic8/protocol. Other packages import from here only.
 */

/**
 * Types of the public API.
 * @typedef {import("./game/OperationDecoder.js").ChainOperation} ChainOperation
 * @typedef {import("./game/EventChain.js").ProtocolEvent} ProtocolEvent
 * @typedef {import("./game/EventChain.js").ChainedEvent} ChainedEvent
 * @typedef {import("./game/records.js").SealedRecord} SealedRecord
 * @typedef {import("./game/engineSetup.js").GameContent} GameContent
 * @typedef {import("./packs/packs.js").DropTable} DropTable
 */
export { CanonicalJsonError, CanonicalJsonErrorCode, canonicalize, parseCanonical, utf8Length } from "./canonical/CanonicalJson.js";
export { HashTag, bytesToHex, hexToBytes, isHash, sha256Hex, taggedHash, taggedHashHex, utf8 } from "./crypto/hash.js";
export { FINISH_CODES, RECEIPT_VERSION, buildReceipts } from "./receipts/receipts.js";
export { MAX_TRADE_CARDS, TRADE_VERSION, parseTradeRecord, tradeRecord } from "./trades/trades.js";
export { SALE_VERSION, parseSaleRecord, saleRecord } from "./sales/sales.js";
export { DROP_TABLE_VERSION, Finish, PACK_SECRET_BYTES, PackEpochKind, drawPack, dropTableHash, dropTableOdds, packEpochAnnouncement, packEpochCommitment, packEpochReveal, packSeed, validateDropTable } from "./packs/packs.js";
export {
  EVENT_KINDS,
  EntropySource,
  EventKind,
  FORCED_COMMAND_TYPES,
  ForcedMoveReason,
  GAME_ID_PATTERN,
  GAME_PROTOCOL_VERSIONS,
  GameMode,
  GameProtocol,
  LATEST_GAME_PROTOCOL,
  LIMITS,
  OperationId,
  PROTOCOL_VERSION,
  SEATS,
  Seat,
} from "./game/constants.js";
export { ProtocolError } from "./game/ProtocolError.js";
export { EventChain, genesisHead, nextHead } from "./game/EventChain.js";
export {
  canonicalDeck,
  deckCommitment,
  deriveEngineSeed,
  firstSeatFor,
  secretFromBytes,
  seedCommitment,
  stateCommitment,
  stateSalt,
} from "./game/commitments.js";
export { MAX_CONTENT_BYTES, contentHashOf, openContent, sealContent } from "./game/content.js";
export { GameRecorder } from "./game/GameRecorder.js";
export { createGameEngine } from "./game/engineSetup.js";
export { ENVELOPE_OVERHEAD_BYTES, MAX_RECORD_BYTES, packEnvelopes, sealRecord, sealRecords } from "./game/records.js";
export { MOVE_SIGNATURE_PATTERN, SESSION_KEY_PATTERN, SchemaError, validateEnvelope, validateRecord } from "./game/schema.js";
export { MOVE_KIND, SignatureStatus, checkMoveSignatures, moveMessage, sessionAuthorization, sessionGrants } from "./game/sessions.js";
export { RejectionReason, decodeGameOperation } from "./game/OperationDecoder.js";
export { HistoryStatus, assembleGameHistory } from "./game/GameHistory.js";
export { ReplayStatus, commandOfMove, replayGame } from "./game/ReplayVerifier.js";
export { ACK_KIND, AckStatus, ackMessage, checkAck, isSignedByItsKey, parseSignedAck } from "./game/acks.js";
export { AckKeyRegistry, BroadcasterRegistry, ManifestKind, PUBLIC_KEY_PATTERN, ackKeysManifest, broadcastersManifest } from "./game/manifest.js";
export { Verdict, verifyGame } from "./game/verifyGame.js";
export { SessionStatus, replayContentOf, verifyGameOnChain } from "./verification/chainVerifier.js";
export { PackVerdict, verifyOrderOnChain, verifyOrderPacks } from "./verification/packVerifier.js";
