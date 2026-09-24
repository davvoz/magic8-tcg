/**
 * Scheduler that yields to the microtask queue without waiting. Used by
 * tests and headless simulations to run AI turns as fast as possible.
 * @type {import("../../application/ports/Scheduler.contract.js").Scheduler}
 */
export const immediateScheduler = Object.freeze({
  delay: () => Promise.resolve(),
});
