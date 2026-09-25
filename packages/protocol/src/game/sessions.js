/**
 * Signed moves (game protocol v2, docs/tcg/12-mosse-firmate.md).
 *
 * A player's browser makes a P-256 key pair that cannot be exported
 * (WebCrypto), and the player's STEEM account authorises its public key once
 * per game with Keychain (`sessionAuthorization`, posting key). Every move
 * the player makes is then signed with that key (`moveMessage`). The server
 * records both (SESSION, MOVE.sig): it can still refuse a move, but it can
 * no longer publish, in a player's name, a move the player did not make.
 *
 * Like acks, the curves live outside the protocol: whoever checks passes
 * `verifyMoveSignature` (P-256) and `recoverSigner` (secp256k1).
 */
import { canonicalize } from "../canonical/CanonicalJson.js";
import { EventKind, GameProtocol } from "./constants.js";

export const MOVE_KIND = "m8tcg_move";

export const SignatureStatus = Object.freeze({
  /** A v1 game: moves are not signed. */
  NOT_REQUIRED: "NOT_REQUIRED",
  /** Every player move carries a valid signature by the seat's session key. */
  VALID: "VALID",
  /** A player move before the seat had any session key. */
  UNSIGNED_MOVE: "UNSIGNED_MOVE",
  /** A player move whose signature is not the seat's session key's. */
  BAD_MOVE_SIGNATURE: "BAD_MOVE_SIGNATURE",
});

/**
 * @typedef {(message: string, signatureHex: string, publicKeyHex: string) => boolean} MoveSignatureVerifier P-256, SHA-256, r ‖ s
 * @typedef {Readonly<{ seat: string, account: string, key: string, authorization: string, eventSeq: number }>} SessionGrant
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
 * The session keys a game's seats authorised, in order.
 * @param {import("./GameHistory.js").GameHistory} history
 * @returns {readonly SessionGrant[]}
 */
export function sessionGrants(history) {
  const created = history.events[0]?.event;
  if (created === undefined || created.k !== EventKind.GAME_CREATED) {
    return Object.freeze([]);
  }
  const accounts = new Map(/** @type {any} */ (created.d).seats.map((/** @type {any} */ entry) => [entry.seat, entry.acct]));
  return Object.freeze(
    history.events
      .filter(({ event }) => event.k === EventKind.SESSION)
      .map(({ event }) => {
        const d = /** @type {any} */ (event.d);
        return Object.freeze({ seat: /** @type {string} */ (event.a), account: accounts.get(event.a), key: d.key, authorization: d.auth, eventSeq: event.i });
      }),
  );
}

/**
 * Checks that every player move of a v2 game is signed by the key the seat
 * had authorised at that point (a later SESSION replaces an earlier one).
 * Forced moves are the server's own and carry no signature.
 * @param {import("./GameHistory.js").GameHistory} history
 * @param {MoveSignatureVerifier | undefined} verifyMoveSignature
 * @returns {Readonly<{ status: string, message: string | null, eventSeq: number | null }>}
 */
export function checkMoveSignatures(history, verifyMoveSignature) {
  if (history.version === null || history.version < GameProtocol.V2) {
    return outcome(SignatureStatus.NOT_REQUIRED);
  }
  if (verifyMoveSignature === undefined) {
    throw new TypeError("a v2 game needs verifyMoveSignature");
  }
  /** @type {Map<string, string>} seat → current session key */
  const keys = new Map();
  for (const { event } of history.events) {
    const d = /** @type {any} */ (event.d);
    if (event.k === EventKind.SESSION) {
      keys.set(/** @type {string} */ (event.a), d.key);
    } else if (event.k === EventKind.MOVE) {
      const key = keys.get(/** @type {string} */ (event.a));
      if (key === undefined) {
        return outcome(SignatureStatus.UNSIGNED_MOVE, `move ${event.i} by ${event.a} before any session key`, event.i);
      }
      const message = moveMessage({ gameId: history.gameId, commandId: d.cid, expectedVersion: d.ev, command: d.cmd });
      if (!verifyMoveSignature(message, d.sig, key)) {
        return outcome(SignatureStatus.BAD_MOVE_SIGNATURE, `move ${event.i} is not signed by ${event.a}'s session key`, event.i);
      }
    }
  }
  return outcome(SignatureStatus.VALID);
}

/**
 * @param {string} status
 * @param {string | null} [message]
 * @param {number | null} [eventSeq]
 */
function outcome(status, message = null, eventSeq = null) {
  return Object.freeze({ status, message, eventSeq });
}
