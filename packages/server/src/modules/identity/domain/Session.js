/**
 * A signed-in session. The token itself is never stored: only its SHA-256.
 *
 * @typedef {Readonly<{
 *   id: string,
 *   userId: string,
 *   tokenHash: string,
 *   loginPublicKey: string,
 *   createdAt: number,
 *   lastSeenAt: number,
 *   expiresAt: number,
 *   revokedAt: number | null,
 *   revokeReason: string | null,
 * }>} Session
 */

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
