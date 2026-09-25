/**
 * A browser's session key for signed moves (docs/tcg/12), made with
 * node:crypto the way WebCrypto makes it: P-256, uncompressed public point,
 * signatures as r ‖ s.
 */
import { generateKeyPairSync, sign } from "node:crypto";

import { moveMessage, sessionAuthorization } from "@magic8/protocol";
import { signMessage } from "@magic8/steem";

export function sessionKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const key = `04${Buffer.from(/** @type {string} */ (jwk.x), "base64url").toString("hex")}${Buffer.from(/** @type {string} */ (jwk.y), "base64url").toString("hex")}`;
  return {
    key,
    /** @param {string} message */
    sign: (message) => sign("sha256", Buffer.from(message), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("hex"),
  };
}

/**
 * The session grant a player sends: the key and their account's Keychain signature over it.
 * @param {string} gameId
 * @param {{ key: string }} session
 * @param {Uint8Array} postingKey the account's private posting key
 */
export function grantFor(gameId, session, postingKey) {
  return { gameId, key: session.key, authorization: signMessage(sessionAuthorization(gameId, session.key), postingKey) };
}

/**
 * A command as a v2 client sends it.
 * @param {{ gameId: string, commandId: string, expectedVersion: number, command: Record<string, unknown> }} move
 * @param {{ sign: (message: string) => string }} session
 */
export function signedCommand(move, session) {
  return { ...move, signature: session.sign(moveMessage(move)) };
}
