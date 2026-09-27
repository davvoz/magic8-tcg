/**
 * Loggers: structured (one JSON object per line, for machines) or readable
 * (one short line, for a person at a terminal). Fields whose name suggests a
 * secret are redacted before anything is written, whatever the caller passes.
 *
 * @typedef {{ debug: (message: string, fields?: object) => void, info: (message: string, fields?: object) => void, warn: (message: string, fields?: object) => void, error: (message: string, fields?: object) => void }} Logger
 */

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
const SENSITIVE_KEY = /token|secret|signature|password|cookie|authorization|private|wif|nonce/i;
const MAX_DEPTH = 6;
const MAX_STRING = 500;

/**
 * @param {unknown} value
 * @param {number} depth
 * @returns {unknown}
 */
export function redact(value, depth = 0) {
  if (depth > MAX_DEPTH) {
    return "[depth]";
  }
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[redacted]" : redact(item, depth + 1)]));
  }
  return value;
}

/**
 * @param {{ write: (line: string) => void, level?: keyof typeof LEVELS, now?: () => number }} options
 * @returns {Logger}
 */
export function createJsonLogger({ write, level = "info", now = Date.now }) {
  const threshold = LEVELS[level];
  const log = (name) => (message, fields = {}) => {
    if (LEVELS[name] < threshold) {
      return;
    }
    write(`${JSON.stringify({ at: new Date(now()).toISOString(), level: name, message, ...(/** @type {object} */ (redact(fields))) })}\n`);
  };
  return Object.freeze({ debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") });
}

/** An identifier nobody reads: a hash, a transaction id, a key, a random id. */
const IDENTIFIER = /^[0-9A-Za-z_-]{20,}$/;
const LEVEL_LABELS = Object.freeze({ debug: "debug", info: "info ", warn: "WARN ", error: "ERROR" });

/**
 * A field as a person reads it, or null when it is noise (an identifier, a nested structure).
 * @param {unknown} value already redacted
 * @returns {string | null}
 */
function readable(value) {
  if (typeof value === "string") {
    if (value === "" || IDENTIFIER.test(value)) {
      return null;
    }
    return /\s/.test(value) ? `"${value}"` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const items = value.map(readable).filter((item) => item !== null);
    return items.length === 0 ? null : items.join(",");
  }
  if (value !== null && typeof value === "object" && typeof (/** @type {any} */ (value).message) === "string") {
    return readable(/** @type {any} */ (value).message);
  }
  return null;
}

/**
 * One short line per entry, for a person at a terminal: time, level, message
 * and the fields worth reading. Hashes, transaction ids, keys and random ids
 * are left out (the JSON logger keeps them, for machines).
 * @param {{ write: (line: string) => void, level?: keyof typeof LEVELS, now?: () => number }} options
 * @returns {Logger}
 */
export function createConsoleLogger({ write, level = "info", now = Date.now }) {
  const threshold = LEVELS[level];
  const log = (name) => (message, fields = {}) => {
    if (LEVELS[name] < threshold) {
      return;
    }
    const details = Object.entries(/** @type {object} */ (redact(fields)))
      .map(([key, value]) => [key, readable(value)])
      .filter(([, value]) => value !== null)
      .map(([key, value]) => `${key}=${value}`);
    const time = new Date(now()).toISOString().slice(11, 19);
    const suffix = details.length === 0 ? "" : `  (${details.join(" ")})`;
    write(`${time} ${LEVEL_LABELS[name]} ${message}${suffix}\n`);
  };
  return Object.freeze({ debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") });
}

/** Collects entries in memory (tests). */
export class MemoryLogger {
  /** @type {{ level: string, message: string, fields: unknown }[]} */
  entries = [];

  debug(message, fields = {}) {
    this.entries.push({ level: "debug", message, fields: redact(fields) });
  }

  info(message, fields = {}) {
    this.entries.push({ level: "info", message, fields: redact(fields) });
  }

  warn(message, fields = {}) {
    this.entries.push({ level: "warn", message, fields: redact(fields) });
  }

  error(message, fields = {}) {
    this.entries.push({ level: "error", message, fields: redact(fields) });
  }
}
