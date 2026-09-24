/**
 * Request body validation shared by every module's routes: the body must be
 * an object with only the listed keys (unknown fields → 400), then the
 * route's own checks run. The first problem becomes the error message.
 */
import { Issues, checkObject } from "@magic8/engine/shared/validation.js";
import { AppError } from "../../kernel/AppError.js";

/**
 * @param {unknown} body
 * @param {readonly string[]} keys
 * @param {(issues: Issues, object: Record<string, unknown>) => void} check
 * @returns {Record<string, unknown>}
 */
export function validated(body, keys, check) {
  const issues = new Issues();
  const object = checkObject(issues, body, "body", keys);
  if (object !== undefined) {
    check(issues, object);
  }
  if (!issues.isEmpty) {
    throw new AppError("VALIDATION", issues.list()[0]);
  }
  return /** @type {Record<string, unknown>} */ (object);
}
