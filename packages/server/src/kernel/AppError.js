/**
 * Expected failures of use cases, with a stable code the API exposes and the
 * HTTP status it maps to. Messages are for clients: never put internals
 * (SQL, stack traces, node URLs) in them.
 */

/** code → HTTP status */
export const ErrorStatus = Object.freeze({
  VALIDATION: 400,
  INVALID_ACCOUNT: 400,
  UNSUPPORTED_NETWORK: 400,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PAYLOAD_TOO_LARGE: 413,
  UNAUTHENTICATED: 401,
  LOGIN_FAILED: 401,
  CHALLENGE_INVALID: 401,
  FORBIDDEN: 403,
  CSRF_REJECTED: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  LIMIT_REACHED: 409,
  STARTER_ALREADY_CLAIMED: 409,
  UNKNOWN_STARTER: 400,
  PRECONDITION_FAILED: 412,
  CARDS_NOT_OWNED: 422,
  PRECONDITION_REQUIRED: 428,
  RATE_LIMITED: 429,
  CHAIN_UNAVAILABLE: 503,
  MAINTENANCE: 503,
  INTERNAL: 500,
});

export class AppError extends Error {
  /**
   * @param {keyof typeof ErrorStatus} code
   * @param {string} message safe to show to clients
   * @param {Readonly<Record<string, unknown>>} [details] safe to show to clients
   */
  constructor(code, message, details) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = ErrorStatus[code] ?? 500;
    this.details = details ?? null;
  }
}
