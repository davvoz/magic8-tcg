/**
 * Scheduler port over setTimeout.
 * @type {import("../../application/ports/Scheduler.contract.js").Scheduler}
 */
export const browserScheduler = Object.freeze({
  /** @param {number} milliseconds */
  delay: (milliseconds) =>
    new Promise((resolve) => {
      setTimeout(resolve, Math.max(0, milliseconds));
    }),
});
