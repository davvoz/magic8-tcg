/**
 * Reads a JSON request body: content type checked, size capped while
 * streaming (not after), parsed once by the safe parser (no prototype keys,
 * bounded depth), and returned as untrusted data for a schema validator.
 */
import { AppError } from "../../kernel/AppError.js";
import { parseJson } from "../../kernel/json.js";

const JSON_TYPE = /^application\/json\s*(;\s*charset=utf-8\s*)?$/i;

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {number} maxBytes
 * @returns {Promise<unknown>}
 */
export async function readJsonBody(request, maxBytes) {
  if (!JSON_TYPE.test(request.headers["content-type"] ?? "")) {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", "expected application/json");
  }
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AppError("PAYLOAD_TOO_LARGE", `the body must be at most ${maxBytes} bytes`);
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      request.destroy();
      throw new AppError("PAYLOAD_TOO_LARGE", `the body must be at most ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    return parseJson(text);
  } catch {
    throw new AppError("VALIDATION", "the body is not valid UTF-8 JSON");
  }
}
