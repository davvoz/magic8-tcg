/**
 * A promise, or a fallback value once it has taken too long.
 * @template T, F
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {F} fallback
 * @returns {Promise<T | F>}
 */
export function withTimeout(promise, ms, fallback) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}
