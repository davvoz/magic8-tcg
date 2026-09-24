/**
 * Database failures translated from PostgreSQL SQLSTATE codes, so that
 * application code reacts to "this row already exists" without knowing the
 * driver. Constraint names come from the schema (migrations/*.sql).
 */

export const DbErrorCode = Object.freeze({
  UNIQUE_VIOLATION: "UNIQUE_VIOLATION",
  FOREIGN_KEY_VIOLATION: "FOREIGN_KEY_VIOLATION",
  CHECK_VIOLATION: "CHECK_VIOLATION",
  NOT_NULL_VIOLATION: "NOT_NULL_VIOLATION",
  SERIALIZATION_FAILURE: "SERIALIZATION_FAILURE",
  DEADLOCK: "DEADLOCK",
  FORBIDDEN_MUTATION: "FORBIDDEN_MUTATION",
  UNKNOWN: "UNKNOWN",
});

const BY_SQLSTATE = Object.freeze({
  23505: DbErrorCode.UNIQUE_VIOLATION,
  23503: DbErrorCode.FOREIGN_KEY_VIOLATION,
  23514: DbErrorCode.CHECK_VIOLATION,
  23502: DbErrorCode.NOT_NULL_VIOLATION,
  40001: DbErrorCode.SERIALIZATION_FAILURE,
  "40P01": DbErrorCode.DEADLOCK,
  // insufficient_privilege: raised by forbid_mutation() and the seal-only triggers (and by table grants in production)
  42501: DbErrorCode.FORBIDDEN_MUTATION,
});

export class DbError extends Error {
  /**
   * @param {string} code one of DbErrorCode
   * @param {string} message
   * @param {{ constraint?: string | null, sqlState?: string | null, cause?: unknown }} [details]
   */
  constructor(code, message, { constraint = null, sqlState = null, cause } = {}) {
    super(message, { cause });
    this.name = "DbError";
    this.code = code;
    this.constraint = constraint;
    this.sqlState = sqlState;
    /** Set when the connection could not even roll back: drivers discard it instead of pooling it. */
    this.brokenSession = false;
    /** The rollback's own failure, when brokenSession is set. @type {unknown} */
    this.rollbackError = null;
  }

  /** @param {string} constraint */
  isUniqueViolationOf(constraint) {
    return this.code === DbErrorCode.UNIQUE_VIOLATION && this.constraint === constraint;
  }
}

/**
 * Wraps any driver error; the original stays in `cause` for the logs.
 * @param {unknown} error
 */
export function toDbError(error) {
  if (error instanceof DbError) {
    return error;
  }
  const raw = /** @type {{ code?: unknown, constraint?: unknown, message?: unknown }} */ (error ?? {});
  const sqlState = typeof raw.code === "string" ? raw.code : null;
  const code = sqlState === null ? DbErrorCode.UNKNOWN : (BY_SQLSTATE[/** @type {keyof typeof BY_SQLSTATE} */ (sqlState)] ?? DbErrorCode.UNKNOWN);
  const message = typeof raw.message === "string" ? raw.message : "database error";
  return new DbError(code, message, { constraint: typeof raw.constraint === "string" ? raw.constraint : null, sqlState, cause: error });
}
