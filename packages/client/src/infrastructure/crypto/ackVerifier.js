/**
 * Checks a signed ack (docs/tcg/11-ack-firmati.md): well formed, and signed
 * by the key it names. The protocol builds the signed text; secp256k1
 * recovery comes from the STEEM package, as for Keychain logins.
 */
import { isSignedByItsKey, parseSignedAck } from "@magic8/protocol";
import { recoverSigner } from "@magic8/steem";

/**
 * @param {unknown} ack
 * @returns {boolean}
 */
export function verifySignedAck(ack) {
  const parsed = parseSignedAck(ack);
  return parsed !== null && isSignedByItsKey(parsed, recoverSigner);
}
