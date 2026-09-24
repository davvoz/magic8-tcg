import { LIMITS } from "./limits.js";

/**
 * Recursively freezes plain data (objects and arrays). Depth is bounded and
 * cycles are tolerated so hostile or accidental structures cannot cause
 * unbounded recursion. Class instances are frozen shallowly only when reached
 * as the root, never descended into.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepFreeze(value) {
  freezeInto(value, new WeakSet(), 0);
  return value;
}

/**
 * @param {unknown} value
 * @param {WeakSet<object>} visited
 * @param {number} depth
 */
function freezeInto(value, visited, depth) {
  if (value === null || typeof value !== "object" || visited.has(value)) {
    return;
  }
  if (depth > LIMITS.MAX_FREEZE_DEPTH) {
    throw new RangeError("deepFreeze: structure exceeds maximum depth");
  }
  visited.add(value);
  Object.freeze(value);
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    freezeInto(child, visited, depth + 1);
  }
}
