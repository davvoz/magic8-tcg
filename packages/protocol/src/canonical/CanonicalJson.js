/**
 * Canonical JSON (M8CJ), docs/tcg/03-game-blockchain-protocol.md §3.
 *
 * A strict subset of RFC 8785 (JCS): null, booleans, strings, safe integers,
 * arrays and plain objects; keys sorted by UTF-16 code units; no whitespace.
 * Every value has exactly one serialisation, so anything hashed can be
 * re-hashed identically by any verifier in any language.
 *
 * `parseCanonical` additionally requires its input to *be* canonical: text
 * that parses but is not byte-identical to its re-serialisation (duplicate
 * keys, whitespace, "1.0", unsorted keys) is rejected. That removes every
 * parser-dependent ambiguity from data read off the chain.
 */
import { deepFreeze } from "@magic8/engine/shared/deepFreeze.js";

export const CanonicalJsonErrorCode = Object.freeze({
  UNSUPPORTED_VALUE: "UNSUPPORTED_VALUE",
  TOO_DEEP: "TOO_DEEP",
  TOO_LARGE: "TOO_LARGE",
  FORBIDDEN_KEY: "FORBIDDEN_KEY",
  NOT_JSON: "NOT_JSON",
  NOT_CANONICAL: "NOT_CANONICAL",
});

export class CanonicalJsonError extends Error {
  /**
   * @param {string} code one of CanonicalJsonErrorCode
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "CanonicalJsonError";
    this.code = code;
  }
}

export const DEFAULT_MAX_DEPTH = 16;

/** Keys that could reach an object prototype in careless downstream code. */
const FORBIDDEN_KEYS = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));

const encoder = new TextEncoder();

/**
 * @param {string} text
 * @returns {number} UTF-8 length in bytes
 */
export function utf8Length(text) {
  return encoder.encode(text).length;
}

/**
 * @param {unknown} value
 * @param {{ maxDepth?: number }} [options]
 * @returns {string}
 */
export function canonicalize(value, { maxDepth = DEFAULT_MAX_DEPTH } = {}) {
  return serialize(value, 0, maxDepth, "$");
}

/**
 * @param {unknown} value
 * @param {number} depth
 * @param {number} maxDepth
 * @param {string} path
 * @returns {string}
 */
function serialize(value, depth, maxDepth, path) {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      return serializeNumber(value, path);
    case "object":
      return serializeContainer(/** @type {object} */ (value), depth, maxDepth, path);
    default:
      throw new CanonicalJsonError(CanonicalJsonErrorCode.UNSUPPORTED_VALUE, `${path}: ${typeof value} is not allowed`);
  }
}

/**
 * @param {number} value
 * @param {string} path
 */
function serializeNumber(value, path) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
    throw new CanonicalJsonError(CanonicalJsonErrorCode.UNSUPPORTED_VALUE, `${path}: only safe integers are allowed, got ${value}`);
  }
  return String(value);
}

/**
 * @param {object} value
 * @param {number} depth
 * @param {number} maxDepth
 * @param {string} path
 */
function serializeContainer(value, depth, maxDepth, path) {
  if (depth >= maxDepth) {
    throw new CanonicalJsonError(CanonicalJsonErrorCode.TOO_DEEP, `${path}: nesting deeper than ${maxDepth}`);
  }
  if (Array.isArray(value)) {
    const items = value.map((item, index) => serialize(item, depth + 1, maxDepth, `${path}[${index}]`));
    return `[${items.join(",")}]`;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalJsonError(CanonicalJsonErrorCode.UNSUPPORTED_VALUE, `${path}: only plain objects are allowed`);
  }
  const keys = Object.keys(value).sort(compareCodeUnits);
  const members = [];
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new CanonicalJsonError(CanonicalJsonErrorCode.FORBIDDEN_KEY, `${path}: key "${key}" is not allowed`);
    }
    const item = /** @type {Record<string, unknown>} */ (value)[key];
    if (item === undefined) {
      throw new CanonicalJsonError(CanonicalJsonErrorCode.UNSUPPORTED_VALUE, `${path}.${key}: undefined is not allowed`);
    }
    const member = serialize(item, depth + 1, maxDepth, `${path}.${key}`);
    members.push(`${JSON.stringify(key)}:${member}`);
  }
  return `{${members.join(",")}}`;
}

/**
 * Orders strings by UTF-16 code units (what RFC 8785 specifies), independent of locale.
 * @param {string} left
 * @param {string} right
 */
function compareCodeUnits(left, right) {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * Parses text that must already be in canonical form.
 * @param {string} text
 * @param {{ maxBytes?: number, maxDepth?: number }} [options]
 * @returns {unknown}
 */
export function parseCanonical(text, { maxBytes = Number.POSITIVE_INFINITY, maxDepth = DEFAULT_MAX_DEPTH } = {}) {
  if (typeof text !== "string") {
    throw new CanonicalJsonError(CanonicalJsonErrorCode.NOT_JSON, "input must be a string");
  }
  if (utf8Length(text) > maxBytes) {
    throw new CanonicalJsonError(CanonicalJsonErrorCode.TOO_LARGE, `input exceeds ${maxBytes} bytes`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CanonicalJsonError(CanonicalJsonErrorCode.NOT_JSON, "input is not valid JSON");
  }
  const canonical = canonicalize(parsed, { maxDepth });
  if (canonical !== text) {
    throw new CanonicalJsonError(CanonicalJsonErrorCode.NOT_CANONICAL, "input is not in canonical form");
  }
  return deepFreeze(parsed);
}
