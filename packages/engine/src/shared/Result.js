/**
 * Result: the return type for operations with expected failure modes
 * (validation, persistence, rule checks). Exceptions are reserved for
 * programmer errors, never for untrusted input.
 *
 * @template T
 * @typedef {Readonly<{ ok: true, value: T }>} Ok
 */

/**
 * @typedef {Readonly<{ code: string, message: string, details: unknown }>} ResultError
 * @typedef {Readonly<{ ok: false, error: ResultError }>} Fail
 */

/**
 * @template T
 * @param {T} value
 * @returns {Ok<T>}
 */
export function ok(value) {
  return Object.freeze({ ok: true, value });
}

/**
 * @param {string} code Machine-readable code, e.g. "VALIDATION", "NOT_FOUND".
 * @param {string} message Human-readable summary.
 * @param {unknown} [details] Structured detail (problem list, ids, …).
 * @returns {Fail}
 */
export function fail(code, message, details) {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message, details: details ?? null }),
  });
}

/**
 * @param {unknown} result
 * @returns {result is Ok<unknown>}
 */
export function isOk(result) {
  return typeof result === "object" && result !== null && result.ok === true;
}
