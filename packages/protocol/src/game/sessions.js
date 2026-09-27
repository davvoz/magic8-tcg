/**
 * Signed moves (game protocol v2, docs/tcg/12-mosse-firmate.md).
 *
 * A player's browser makes a P-256 key pair that cannot be exported
 * (WebCrypto), and the player's STEEM account authorises its public key once
 * per game with Keychain (`sessionAuthorization`, posting key). Every move
 * the player makes is then signed with that key (`moveMessage`). The server
 * records both (SESSION, MOVE.sig): it can still refuse a move, but it can
 * no longer record, in a player's name, a move the player did not make.
 *
 * Like acks, the curves live outside the protocol: whoever checks passes
 * the verifier in (P-256 for moves, secp256k1 for the authorisation).
 */
import { canonicalize } from "../canonical/CanonicalJson.js";
import { GameProtocol } from "./constants.js";

export const MOVE_KIND = "m8tcg_move";

/**
 * @typedef {(message: string, signatureHex: string, publicKeyHex: string) => boolean} MoveSignatureVerifier P-256, SHA-256, r ‖ s
 */

/**
 * What the player's account signs (Keychain, posting key) to authorise a session key for one game.
 * Plain text: Keychain shows it to the player before they approve.
 * @param {string} gameId
 * @param {string} sessionKey uncompressed P-256 point as hex
 */
export function sessionAuthorization(gameId, sessionKey) {
  return `m8tcg session ${gameId} ${sessionKey}`;
}

/**
 * What the session key signs for one move: the command, its id, and the
 * version it was decided on, in this game.
 * @param {{ gameId: string, commandId: string, expectedVersion: number, command: Readonly<Record<string, unknown>> }} move command without playerId
 * @returns {string} canonical JSON
 */
export function moveMessage({ gameId, commandId, expectedVersion, command }) {
  return canonicalize({ c: command, cid: commandId, ev: expectedVersion, g: gameId, kind: MOVE_KIND, v: GameProtocol.V2 });
}

/**
 * The engine command a MOVE event carries: v2 wraps it with its signature.
 * @param {Readonly<Record<string, unknown>>} data the MOVE payload
 * @param {number} version the game protocol version
 */
export function commandOfMove(data, version) {
  return version >= GameProtocol.V2 ? /** @type {Readonly<Record<string, unknown>>} */ (data.cmd) : data;
}
