/**
 * Versioned wrapper for anything persisted: `{ schemaVersion, payload }`.
 * Reading validates the envelope shape, the version and a size cap before
 * the payload is handed to a domain validator. Storage is treated exactly
 * like a downloaded file: never trusted.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { Issues, checkInteger, checkObject } from "@magic8/engine/shared/validation.js";

export const EnvelopeError = Object.freeze({
  TOO_LARGE: "ENVELOPE_TOO_LARGE",
  MALFORMED: "ENVELOPE_MALFORMED",
  VERSION: "ENVELOPE_VERSION",
});

const ENVELOPE_KEYS = Object.freeze(["schemaVersion", "payload"]);

/**
 * @param {number} schemaVersion
 * @param {unknown} payload JSON-serialisable data.
 * @param {number} maxBytes
 * @returns {import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function sealEnvelope(schemaVersion, payload, maxBytes) {
  const text = JSON.stringify({ schemaVersion, payload });
  if (text.length > maxBytes) {
    return fail(EnvelopeError.TOO_LARGE, `payload exceeds ${maxBytes} bytes`);
  }
  return ok(text);
}

/**
 * @param {string} text
 * @param {{ schemaVersion: number, maxBytes: number }} expectations
 * @returns {import("@magic8/engine/shared/Result.js").Ok<unknown> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function openEnvelope(text, { schemaVersion, maxBytes }) {
  if (typeof text !== "string" || text.length > maxBytes) {
    return fail(EnvelopeError.TOO_LARGE, `stored data exceeds ${maxBytes} bytes`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail(EnvelopeError.MALFORMED, "stored data is not valid JSON");
  }
  const issues = new Issues();
  const object = checkObject(issues, parsed, "envelope", ENVELOPE_KEYS);
  if (object === undefined || !issues.isEmpty) {
    return fail(EnvelopeError.MALFORMED, "stored data is not an envelope", { problems: issues.list() });
  }
  const version = checkInteger(issues, object.schemaVersion, "envelope.schemaVersion", { min: 1 });
  if (version === undefined) {
    return fail(EnvelopeError.MALFORMED, "stored data has no schema version");
  }
  if (version !== schemaVersion) {
    return fail(EnvelopeError.VERSION, `stored schema version ${version} is not supported (expected ${schemaVersion})`, { found: version });
  }
  return ok(object.payload);
}
