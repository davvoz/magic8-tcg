/**
 * Signed acks (docs/tcg/11-ack-firmati.md): for every command it accepts,
 * the server signs what the game became — the command id, the sequence and
 * chain head of the last event it produced, the engine version — with a key
 * the root account names in an `ack_keys` manifest.
 *
 * The head commits to the whole event chain up to that event, so a player
 * who keeps the acks can later show, against the chain alone, that the
 * published game differs from what the server accepted (DIVERGENT) or leaves
 * out a move it accepted (OMITTED). Only the ack key can produce such a
 * proof, so it cannot be forged by a player.
 *
 * The protocol stays free of elliptic-curve code: whoever checks signatures
 * passes `recoverSigner` (message, signature) → public key, from @magic8/steem.
 */
import { Issues, checkInteger, checkObject, checkString } from "@magic8/engine/shared/validation.js";
import { canonicalize } from "../canonical/CanonicalJson.js";
import { EventKind, GAME_ID_PATTERN, PROTOCOL_VERSION } from "./constants.js";
import { PUBLIC_KEY_PATTERN } from "./manifest.js";

export const ACK_KIND = "m8tcg_ack";

export const AckStatus = Object.freeze({
  /** The chain holds the acknowledged event with the same head. */
  CONSISTENT: "CONSISTENT",
  /** The chain holds that event with another head: the server published a different game than it acknowledged. */
  DIVERGENT: "DIVERGENT",
  /** The published game ended without the acknowledged event. */
  OMITTED: "OMITTED",
  /** Not on the chain yet (the game goes on, or its records wait to be published). */
  NOT_PUBLISHED: "NOT_PUBLISHED",
  /** The signature is not the named key's. */
  BAD_SIGNATURE: "BAD_SIGNATURE",
  /** The key is not an ack key the root authorised when the game was created. */
  UNTRUSTED_KEY: "UNTRUSTED_KEY",
  /** Malformed, or for another game. */
  INVALID: "INVALID",
});

const ACK_KEYS = Object.freeze(["at", "commandId", "gameId", "head", "key", "seq", "sig", "version"]);
const HEX_64 = /^[0-9a-f]{64}$/;
const SIGNATURE = /^[0-9a-f]{130}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * @typedef {Readonly<{ gameId: string, commandId: string, seq: number, head: string, version: number, at: number, key: string }>} AckFields
 * @typedef {Readonly<AckFields & { sig: string }>} SignedAck
 * @typedef {(message: string, signatureHex: string) => string | null} RecoverSigner
 */

/**
 * The exact text the ack key signs (canonical JSON).
 * @param {AckFields} ack
 * @returns {string}
 */
export function ackMessage({ gameId, commandId, seq, head, version, at, key }) {
  return canonicalize({ at, cmd: commandId, g: gameId, head, key, kind: ACK_KIND, seq, v: PROTOCOL_VERSION, ver: version });
}

/**
 * A signed ack as a player keeps it, checked for shape (not for signature).
 * @param {unknown} value
 * @returns {SignedAck | null}
 */
export function parseSignedAck(value) {
  const issues = new Issues();
  const ack = checkObject(issues, value, "ack", ACK_KEYS);
  if (ack === undefined) {
    return null;
  }
  checkString(issues, ack.gameId, "ack.gameId", { pattern: GAME_ID_PATTERN });
  checkString(issues, ack.commandId, "ack.commandId", { pattern: UUID });
  checkString(issues, ack.head, "ack.head", { pattern: HEX_64 });
  checkString(issues, ack.key, "ack.key", { pattern: PUBLIC_KEY_PATTERN });
  checkString(issues, ack.sig, "ack.sig", { pattern: SIGNATURE });
  checkInteger(issues, ack.seq, "ack.seq", { min: 0 });
  checkInteger(issues, ack.version, "ack.version", { min: 0 });
  checkInteger(issues, ack.at, "ack.at", { min: 0 });
  return issues.isEmpty ? /** @type {SignedAck} */ (Object.freeze({ ...ack })) : null;
}

/**
 * Whether the ack's signature is its key's.
 * @param {SignedAck} ack
 * @param {RecoverSigner} recoverSigner
 */
export function isSignedByItsKey(ack, recoverSigner) {
  return recoverSigner(ackMessage(ack), ack.sig) === ack.key;
}

/**
 * Checks one ack against the game as the chain shows it.
 * @param {unknown} value the ack as kept
 * @param {{
 *   history: import("./GameHistory.js").GameHistory,
 *   recoverSigner: RecoverSigner,
 *   isTrustedKey: (key: string) => boolean,
 * }} input
 * @returns {Readonly<{ status: string, commandId: string | null, seq: number | null }>}
 */
export function checkAck(value, { history, recoverSigner, isTrustedKey }) {
  const ack = parseSignedAck(value);
  if (ack === null || ack.gameId !== history.gameId) {
    return result(AckStatus.INVALID, ack);
  }
  if (!isSignedByItsKey(ack, recoverSigner)) {
    return result(AckStatus.BAD_SIGNATURE, ack);
  }
  if (!isTrustedKey(ack.key)) {
    return result(AckStatus.UNTRUSTED_KEY, ack);
  }
  const published = history.events.find((chained) => chained.event.i === ack.seq);
  if (published !== undefined) {
    return result(published.head === ack.head ? AckStatus.CONSISTENT : AckStatus.DIVERGENT, ack);
  }
  const ended = history.terminal === EventKind.GAME_FINISHED || history.terminal === EventKind.GAME_ABORTED;
  return result(ended ? AckStatus.OMITTED : AckStatus.NOT_PUBLISHED, ack);
}

/**
 * @param {string} status
 * @param {SignedAck | null} ack
 */
function result(status, ack) {
  return Object.freeze({ status, commandId: ack?.commandId ?? null, seq: ack?.seq ?? null });
}
