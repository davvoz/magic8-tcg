/**
 * Structured logger (one JSON object per line). Fields whose name suggests a
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
