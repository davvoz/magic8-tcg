/**
 * Signed acks (docs/tcg/11-ack-firmati.md): for every command it accepts,
 * the server signs what the game became — the command id, the sequence and
 * chain head of the last event it produced, the engine version — with a key
 * the root account names in an `ack_keys` manifest.
 *
 * The head commits to the whole event chain up to that event, so a player
 * who keeps the acks holds a proof of what the server accepted: only the ack
 * key can produce it, so a player cannot forge one.
 *
 * The protocol stays free of elliptic-curve code: whoever checks signatures
 * passes `recoverSigner` (message, signature) → public key, from @magic8/steem.
 */
import { Issues, checkInteger, checkObject, checkString } from "@magic8/engine/shared/validation.js";
import { canonicalize } from "../canonical/CanonicalJson.js";
import { GAME_ID_PATTERN, PROTOCOL_VERSION } from "./constants.js";
import { PUBLIC_KEY_PATTERN } from "./manifest.js";

export const ACK_KIND = "m8tcg_ack";

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
