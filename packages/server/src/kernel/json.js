/**
 * The one JSON parser for untrusted input on the server (docs/tcg/05 T25):
 * refuses the keys that reach object prototypes when data is later merged
 * (`__proto__`, `constructor`, `prototype`) and nesting deeper than a bound,
 * so a hostile body cannot pollute prototypes nor exhaust the stack of the
 * code that walks it. Everything else is ordinary JSON.
 */
const FORBIDDEN_KEYS = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));
export const DEFAULT_MAX_DEPTH = 32;

export class JsonInputError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "JsonInputError";
  }
}

/**
 * @param {unknown} root
 * @param {number} maxDepth
 */
function checkDepth(root, maxDepth) {
  /** @type {[unknown, number][]} */
  const stack = [[root, 1]];
  while (stack.length > 0) {
    const [value, depth] = /** @type {[unknown, number]} */ (stack.pop());
    if (value === null || typeof value !== "object") {
      continue;
    }
    if (depth > maxDepth) {
      throw new JsonInputError(`JSON nested deeper than ${maxDepth}`);
    }
    for (const child of Object.values(value)) {
      stack.push([child, depth + 1]);
    }
  }
}

/**
 * @param {string} text
 * @param {{ maxDepth?: number }} [options]
 * @returns {unknown}
 * @throws {JsonInputError}
 */
export function parseJson(text, { maxDepth = DEFAULT_MAX_DEPTH } = {}) {
  let value;
  try {
    value = JSON.parse(text, (key, item) => {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new JsonInputError(`key "${key}" is not allowed`);
      }
      return item;
    });
  } catch (error) {
    throw error instanceof JsonInputError ? error : new JsonInputError("not valid JSON");
  }
  checkDepth(value, maxDepth);
  return value;
}
