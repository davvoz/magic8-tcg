/**
 * Identity policies (durations are configuration, these are the defaults and bounds).
 */

export const DEFAULT_IDENTITY_POLICY = Object.freeze({
  /** A login challenge must be signed within this time. */
  challengeTtlMs: 120_000,
  /** A session never lives longer than this. */
  sessionAbsoluteTtlMs: 7 * 24 * 60 * 60 * 1000,
  /** A session unused for this long is dead. */
  sessionIdleTtlMs: 24 * 60 * 60 * 1000,
  /** lastSeenAt is written at most this often (avoids a write per request). */
  sessionTouchIntervalMs: 60_000,
});

/**
 * @param {Partial<typeof DEFAULT_IDENTITY_POLICY>} overrides
 */
export function identityPolicy(overrides = {}) {
  const policy = { ...DEFAULT_IDENTITY_POLICY, ...overrides };
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`identity policy: ${name} must be a positive integer`);
    }
  }
  if (policy.challengeTtlMs > 600_000) {
    throw new TypeError("identity policy: challenges must expire within 10 minutes");
  }
  if (policy.sessionIdleTtlMs > policy.sessionAbsoluteTtlMs) {
    throw new TypeError("identity policy: idle timeout cannot exceed the absolute lifetime");
  }
  return Object.freeze(policy);
}
