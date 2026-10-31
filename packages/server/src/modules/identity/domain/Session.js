/**
 * A signed-in session. The token itself is never stored: only its SHA-256.
 *
 * @typedef {Readonly<{
 *   id: string,
 *   userId: string,
 *   tokenHash: string,
 *   loginPublicKey: string,
 *   method: SessionMethodName,
 *   createdAt: number,
 *   lastSeenAt: number,
 *   expiresAt: number,
 *   revokedAt: number | null,
 *   revokeReason: string | null,
 * }>} Session
 * @typedef {"signature" | "google"} SessionMethodName
 */

/**
 * How a session was opened. SIGNATURE: the account's posting key signed a
 * login challenge. GOOGLE: a Google sign-in of an account whose keys the
 * server keeps (docs/tcg/29-google.md); `loginPublicKey` is then that kept
 * posting key, so the key audit (T18) closes these sessions too.
 */
export const SessionMethod = Object.freeze({
  SIGNATURE: /** @type {const} */ ("signature"),
  GOOGLE: /** @type {const} */ ("google"),
});

export const RevokeReason = Object.freeze({
  LOGOUT: "logout",
  IDLE: "idle",
  KEY_REMOVED: "key_removed",
  USER_SUSPENDED: "user_suspended",
});

/**
 * @param {Session} session
 * @param {number} now
 * @param {{ sessionIdleTtlMs: number }} policy
 * @returns {"active" | "revoked" | "expired" | "idle"}
 */
export function sessionState(session, now, policy) {
  if (session.revokedAt !== null) {
    return "revoked";
  }
  if (now >= session.expiresAt) {
    return "expired";
  }
  if (now - session.lastSeenAt >= policy.sessionIdleTtlMs) {
    return "idle";
  }
  return "active";
}
