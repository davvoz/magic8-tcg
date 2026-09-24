/**
 * Port for time. Keeps setTimeout out of the application layer so sessions
 * can be driven instantly in tests and paced in the browser.
 *
 * @typedef {object} Scheduler
 * @property {(milliseconds: number) => Promise<void>} delay
 */

export const SCHEDULER_METHODS = Object.freeze(["delay"]);
