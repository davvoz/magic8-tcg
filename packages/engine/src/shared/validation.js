/**
 * Validation primitives shared by every validator of untrusted data
 * (content files, persisted storage, UI-submitted commands).
 *
 * Conventions:
 * - Each `check*` function records problems on an `Issues` collector and
 *   returns the validated value, or `undefined` when the value is invalid.
 * - Validators never throw on bad input; they return a Result via
 *   `issues.toResult(...)`.
 * - Paths are dotted (`cards[3].abilities[0].params.amount`) so an error
 *   message points at the exact offending field.
 */
import { fail, ok } from "./Result.js";

/** Keys that could pollute prototypes if copied into objects. */
export const FORBIDDEN_KEYS = Object.freeze(["__proto__", "constructor", "prototype"]);

export const VALIDATION_ERROR = "VALIDATION";

/**
 * True for objects created by literals or JSON.parse (null-prototype objects included).
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * @param {unknown} key
 * @returns {key is string}
 */
export function isSafeKey(key) {
  return typeof key === "string" && !FORBIDDEN_KEYS.includes(key);
}

/** Collects path-qualified validation problems. */
export class Issues {
  /** @type {string[]} */
  #problems = [];

  /**
   * Records a problem. Returns `undefined` so callers can write
   * `return issues.add(path, "...")` from a check function.
   * @param {string} path
   * @param {string} message
   * @returns {undefined}
   */
  add(path, message) {
    this.#problems.push(`${path}: ${message}`);
    return undefined;
  }

  get isEmpty() {
    return this.#problems.length === 0;
  }

  get count() {
    return this.#problems.length;
  }

  /** @returns {readonly string[]} */
  list() {
    return Object.freeze([...this.#problems]);
  }

  /**
   * @template T
   * @param {T} value
   * @param {string} [code]
   * @returns {import("./Result.js").Ok<T> | import("./Result.js").Fail}
   */
  toResult(value, code = VALIDATION_ERROR) {
    if (this.isEmpty) {
      return ok(value);
    }
    return fail(code, `${this.#problems.length} validation problem(s): ${this.#problems[0]}`, {
      problems: this.list(),
    });
  }
}

/**
 * Checks that `value` is a plain object with safe keys, optionally rejecting
 * unknown fields. Unknown fields are reported but do not stop validation.
 * @param {Issues} issues
 * @param {unknown} value
 * @param {string} path
 * @param {readonly string[]} [allowedKeys]
 * @returns {Record<string, unknown> | undefined}
 */
export function checkObject(issues, value, path, allowedKeys) {
  if (!isPlainObject(value)) {
    return issues.add(path, "expected an object");
  }
  for (const key of Object.keys(value)) {
    if (!isSafeKey(key)) {
      return issues.add(path, `forbidden key "${key}"`);
    }
    if (allowedKeys && !allowedKeys.includes(key)) {
      issues.add(`${path}.${key}`, "unknown field");
    }
  }
  return value;
}

/**
 * @param {Issues} issues
 * @param {unknown} value
 * @param {string} path
 * @param {{ minLength?: number, maxLength?: number, pattern?: RegExp }} [options]
 * @returns {string | undefined}
 */
export function checkString(issues, value, path, options = {}) {
  if (typeof value !== "string") {
    return issues.add(path, "expected a string");
  }
  const { minLength = 0, maxLength = Number.POSITIVE_INFINITY, pattern } = options;
  if (value.length < minLength) {
    return issues.add(path, `expected at least ${minLength} character(s)`);
  }
  if (value.length > maxLength) {
    return issues.add(path, `expected at most ${maxLength} character(s)`);
  }
  if (pattern && !pattern.test(value)) {
    return issues.add(path, `does not match ${pattern}`);
  }
  return value;
}

/**
 * @param {Issues} issues
 * @param {unknown} value
 * @param {string} path
 * @param {{ min?: number, max?: number }} [options]
 * @returns {number | undefined}
 */
export function checkInteger(issues, value, path, options = {}) {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = options;
  if (!Number.isInteger(value)) {
    return issues.add(path, "expected an integer");
  }
  if (value < min || value > max) {
    return issues.add(path, `expected an integer in ${min}..${max}`);
  }
  return value;
}

/**
 * @param {Issues} issues
 * @param {unknown} value
 * @param {string} path
 * @returns {boolean | undefined}
 */
export function checkBoolean(issues, value, path) {
  if (typeof value !== "boolean") {
    return issues.add(path, "expected a boolean");
  }
  return value;
}

/**
 * @template {string} T
 * @param {Issues} issues
 * @param {unknown} value
 * @param {string} path
 * @param {readonly T[]} allowed
 * @returns {T | undefined}
 */
export function checkEnum(issues, value, path, allowed) {
  if (typeof value !== "string" || !allowed.includes(/** @type {T} */ (value))) {
    return issues.add(path, `expected one of ${allowed.join(", ")}`);
  }
  return /** @type {T} */ (value);
}

/**
 * @param {Issues} issues
 * @param {unknown} value
 * @param {string} path
 * @param {{ minLength?: number, maxLength?: number }} [options]
 * @returns {unknown[] | undefined}
 */
export function checkArray(issues, value, path, options = {}) {
  if (!Array.isArray(value)) {
    return issues.add(path, "expected an array");
  }
  const { minLength = 0, maxLength = Number.POSITIVE_INFINITY } = options;
  if (value.length < minLength) {
    return issues.add(path, `expected at least ${minLength} item(s)`);
  }
  if (value.length > maxLength) {
    return issues.add(path, `expected at most ${maxLength} item(s)`);
  }
  return value;
}

/**
 * Validates every item of an array with `options.item(item, itemPath)` and
 * returns the array of validated items; `undefined` when any item failed.
 * @template T
 * @param {Issues} issues
 * @param {unknown} value
 * @param {string} path
 * @param {{ minLength?: number, maxLength?: number, item: (item: unknown, itemPath: string) => T | undefined }} options
 * @returns {T[] | undefined}
 */
export function checkArrayOf(issues, value, path, options) {
  const array = checkArray(issues, value, path, options);
  if (array === undefined) {
    return undefined;
  }
  const items = array.map((item, index) => options.item(item, `${path}[${index}]`));
  return items.every((item) => item !== undefined) ? /** @type {T[]} */ (items) : undefined;
}

/**
 * Reports duplicated values of `keyOf(item)` across `items`.
 * @template T
 * @param {Issues} issues
 * @param {readonly T[]} items
 * @param {string} path
 * @param {(item: T) => string} keyOf
 * @returns {boolean} true when no duplicates were found
 */
export function checkUnique(issues, items, path, keyOf) {
  const seen = new Set();
  let unique = true;
  items.forEach((item, index) => {
    const key = keyOf(item);
    if (seen.has(key)) {
      issues.add(`${path}[${index}]`, `duplicate "${key}"`);
      unique = false;
    }
    seen.add(key);
  });
  return unique;
}
