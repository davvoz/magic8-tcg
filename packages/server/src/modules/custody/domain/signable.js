/**
 * What the server signs with the keys it keeps (docs/tcg/29-google.md), and
 * nothing else. It is not a general wallet: a script in the page can at most
 * pay what the game asked for, not send the funds elsewhere.
 */
import { GAME_ID_PATTERN, sessionAuthorization } from "@magic8/protocol";

const SESSION_KEY_PATTERN = /^04[0-9a-f]{128}$/;
const AUTHORIZATION_PATTERN = /^m8tcg session (\S+) (\S+)$/;
const FIELDS = Object.freeze(["network", "from", "to", "asset", "amount", "memo"]);

/**
 * The game and session key a message authorises (12), when it is that text and nothing else.
 * @param {unknown} message
 * @returns {Readonly<{ gameId: string, key: string }> | null}
 */
export function sessionAuthorizationOf(message) {
  const match = typeof message === "string" ? AUTHORIZATION_PATTERN.exec(message) : null;
  if (match === null) {
    return null;
  }
  const [, gameId, key] = match;
  const valid = GAME_ID_PATTERN.test(gameId) && SESSION_KEY_PATTERN.test(key) && sessionAuthorization(gameId, key) === message;
  return valid ? Object.freeze({ gameId, key }) : null;
}

/**
 * Whether a transfer pays exactly an open payment, before it expires.
 * @param {import("../application/ports.js").OpenPayment | null} payment
 * @param {import("../application/ports.js").TransferRequest & { network: string }} transfer
 * @param {number} now
 */
export function paysExactly(payment, transfer, now) {
  return payment !== null && payment.expiresAt > now && FIELDS.every((field) => payment[field] === transfer[field]);
}
