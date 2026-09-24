/**
 * Money: an amount in an asset's smallest unit, as a safe integer. STEEM has
 * 3 decimals, so "12.500 STEEM" is 12500. Amounts are parsed from and
 * formatted to decimal strings exactly: no floating point ever decides a
 * price or a payment (docs/tcg/04-modello-dati.md §3).
 */

const MAX_PRECISION = 8;
/** Largest amount accepted anywhere: fits a safe integer with room for multiplication checks. */
export const MAX_UNITS = Number.MAX_SAFE_INTEGER;

/**
 * @param {unknown} text a decimal like "12.5" or "12.500" (at most `precision` decimals)
 * @param {number} precision decimals of the asset
 * @returns {number | null} the amount in smallest units, or null when not an exact decimal of that precision
 */
export function parseAmount(text, precision) {
  if (typeof text !== "string" || !Number.isInteger(precision) || precision < 0 || precision > MAX_PRECISION) {
    return null;
  }
  const match = /^(0|[1-9]\d{0,14})(?:\.(\d+))?$/.exec(text);
  if (match === null || (match[2] !== undefined && match[2].length > precision)) {
    return null;
  }
  const units = BigInt(match[1]) * 10n ** BigInt(precision) + BigInt((match[2] ?? "").padEnd(precision, "0") || "0");
  return units <= BigInt(MAX_UNITS) ? Number(units) : null;
}

/**
 * @param {number} units
 * @param {number} precision
 * @returns {string} e.g. "12.500"
 */
export function formatAmount(units, precision) {
  if (!Number.isSafeInteger(units) || units < 0) {
    throw new RangeError("formatAmount: units must be a non-negative safe integer");
  }
  if (precision === 0) {
    return String(units);
  }
  const digits = String(units).padStart(precision + 1, "0");
  return `${digits.slice(0, -precision)}.${digits.slice(-precision)}`;
}

/**
 * `a * b` when the result is a safe integer, null otherwise.
 * @param {number} a
 * @param {number} b
 */
export function safeMultiply(a, b) {
  const product = a * b;
  return Number.isSafeInteger(product) ? product : null;
}
