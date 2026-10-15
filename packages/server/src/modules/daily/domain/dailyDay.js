/**
 * A challenge day: a UTC calendar date, "YYYY-MM-DD". A day starts at
 * midnight UTC for everyone, whatever their time zone.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {number} ms
 * @returns {string}
 */
export function dayOf(ms) {
  return new Date(Math.floor(ms / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * @param {string} day
 * @returns {number} the day's first millisecond
 */
export function startOf(day) {
  if (!DAY_PATTERN.test(day)) {
    throw new RangeError(`"${day}" is not a day (YYYY-MM-DD)`);
  }
  return Date.parse(`${day}T00:00:00.000Z`);
}

/** @param {string} day the moment the next day starts */
export function endOf(day) {
  return startOf(day) + DAY_MS;
}
