/**
 * Token-bucket rate limiting per (bucket, key), in memory. Each process
 * limits on its own; behind several processes, limits are per process (a
 * shared store is a drop-in replacement of this class).
 */

/**
 * @typedef {Readonly<{ name: string, capacity: number, refillPerSecond: number }>} BucketPolicy
 */

export class RateLimiter {
  /** @type {Map<string, { tokens: number, updatedAt: number }>} */
  #buckets = new Map();
  #now;
  #maxKeys;

  /** @param {{ now: () => number, maxKeys?: number }} options */
  constructor({ now, maxKeys = 100_000 }) {
    this.#now = now;
    this.#maxKeys = maxKeys;
  }

  /**
   * Takes one token.
   * @param {BucketPolicy} policy
   * @param {string} key e.g. client IP or user id
   * @returns {{ allowed: boolean, retryAfterSeconds: number }}
   */
  take(policy, key) {
    const id = `${policy.name}\u0000${key}`;
    const now = this.#now();
    const bucket = this.#buckets.get(id) ?? { tokens: policy.capacity, updatedAt: now };
    const elapsedSeconds = Math.max(0, now - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(policy.capacity, bucket.tokens + elapsedSeconds * policy.refillPerSecond);
    bucket.updatedAt = now;
    this.#buckets.delete(id);
    this.#buckets.set(id, bucket);
    this.#evictOverflow();
    if (bucket.tokens < 1) {
      return { allowed: false, retryAfterSeconds: Math.ceil((1 - bucket.tokens) / policy.refillPerSecond) };
    }
    bucket.tokens -= 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Least recently used keys go first; an evicted key simply starts with a full bucket. */
  #evictOverflow() {
    while (this.#buckets.size > this.#maxKeys) {
      const oldest = this.#buckets.keys().next().value;
      this.#buckets.delete(/** @type {string} */ (oldest));
    }
  }
}
