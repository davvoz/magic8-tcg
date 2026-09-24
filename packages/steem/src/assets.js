/**
 * STEEM asset strings, parsed exactly: "12.500 STEEM" is 12500 units of
 * STEEM (3 decimals). No floating point ever touches an amount. Only the
 * legacy string form the condenser API returns is accepted.
 */

/** Assets of the STEEM chain and their precision. */
export const STEEM_ASSETS = Object.freeze([Object.freeze({ asset: "STEEM", precision: 3 }), Object.freeze({ asset: "SBD", precision: 3 })]);

const ASSET_PATTERN = /^(0|[1-9]\d{0,14})\.(\d{3}) (STEEM|SBD)$/;

/**
 * @param {unknown} text e.g. "12.500 STEEM"
 * @returns {Readonly<{ asset: string, amount: number }> | null} amount in thousandths; null when not an exact STEEM asset string
 */
export function parseSteemAsset(text) {
  if (typeof text !== "string") {
    return null;
  }
  const match = ASSET_PATTERN.exec(text);
  if (match === null) {
    return null;
  }
  const amount = Number(match[1]) * 1000 + Number(match[2]);
  return Number.isSafeInteger(amount) ? Object.freeze({ asset: match[3], amount }) : null;
}

/**
 * @param {number} amount thousandths
 * @param {string} asset "STEEM" or "SBD"
 * @returns {string} e.g. "12.500 STEEM"
 */
export function formatSteemAsset(amount, asset) {
  if (!Number.isSafeInteger(amount) || amount < 0 || !STEEM_ASSETS.some((entry) => entry.asset === asset)) {
    throw new RangeError("formatSteemAsset: expected a non-negative integer amount of STEEM or SBD");
  }
  return `${Math.floor(amount / 1000)}.${String(amount % 1000).padStart(3, "0")} ${asset}`;
}
