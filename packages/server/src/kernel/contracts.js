/**
 * Contracts are JSDoc typedefs plus a list of method names; wiring code
 * asserts implementations at startup so a missing method fails fast.
 */

/**
 * @param {unknown} candidate
 * @param {readonly string[]} methods
 * @param {string} name
 */
export function assertImplements(candidate, methods, name) {
  const missing = methods.filter((method) => typeof (/** @type {any} */ (candidate)?.[method]) !== "function");
  if (missing.length > 0) {
    throw new TypeError(`${name} is missing ${missing.join(", ")}`);
  }
}
