/**
 * Clock port. Application code never calls Date.now(): it receives a clock,
 * so expiry, sessions and timers are testable with a fake one.
 *
 * @typedef {{ now: () => number }} Clock  milliseconds since the Unix epoch
 */

/** @type {Clock} */
export const systemClock = Object.freeze({ now: () => Date.now() });

/** A clock that only moves when told to (tests, simulations). */
export class ManualClock {
  #now;

  /** @param {number} [start] */
  constructor(start = Date.UTC(2026, 0, 1)) {
    this.#now = start;
  }

  now() {
    return this.#now;
  }

  /** @param {number} milliseconds */
  advance(milliseconds) {
    this.#now += milliseconds;
  }
}
