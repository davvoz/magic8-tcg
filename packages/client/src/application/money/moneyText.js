/**
 * How the screens write amounts of money. STEEM has three decimals
 * ("12.500"), which read badly; players see:
 *
 * - `moneyText`: an exact amount (a price, a total, a transfer) without the
 *   zeros it does not need, grouped by thousands: "1 STEEM", "0.5 STEEM",
 *   "12.5 STEEM", "1,250 STEEM". Nothing is lost: "0.125" stays "0.125".
 * - `roundMoneyText`: a figure to take in at a glance (the jackpot, its
 *   prizes, what a wallet holds), rounded down: whole units from 10 up,
 *   at most two decimals below: "866 STEEM", "86 STEEM", "9.99 STEEM".
 *   Rounded down, so it never promises more than there is.
 *
 * Amounts are the server's decimal strings; nothing goes through floating
 * point. Pure.
 */

/** From this many whole units up, a rounded figure shows no decimals. */
const WHOLE_FROM = 10n;
/** Below that, the decimals a rounded figure keeps. */
const ROUND_DECIMALS = 2;

/**
 * "1,250.5" from "1250.500": the amount exact, without trailing zeros, grouped by thousands.
 * @param {string} amount a decimal string ("12.500")
 */
export function amountText(amount) {
  const parsed = parse(amount);
  return parsed === null ? amount : join(parsed.sign, parsed.whole, trimZeros(parsed.fraction));
}

/**
 * "12.5 STEEM"
 * @param {string} amount
 * @param {string} asset
 */
export function moneyText(amount, asset) {
  return `${amountText(amount)} ${asset}`;
}

/**
 * "866" from "866.666", "9.99" from "9.999": rounded down, whole units from 10 up, at most two decimals below.
 * @param {string} amount
 */
export function roundAmountText(amount) {
  const parsed = parse(amount);
  if (parsed === null) {
    return amount;
  }
  const kept = BigInt(parsed.whole) >= WHOLE_FROM ? "" : parsed.fraction.slice(0, ROUND_DECIMALS);
  return join(parsed.sign, parsed.whole, trimZeros(kept));
}

/**
 * "866 STEEM"
 * @param {string} amount
 * @param {string} asset
 */
export function roundMoneyText(amount, asset) {
  return `${roundAmountText(amount)} ${asset}`;
}

const DIGITS = "0123456789";
/** @param {string} text */
const allDigits = (text) => text.length > 0 && [...text].every((char) => DIGITS.includes(char));

/**
 * @param {string} amount
 * @returns {{ sign: string, whole: string, fraction: string } | null} null when it is not a decimal number
 */
function parse(amount) {
  const text = amount.trim();
  const sign = text.startsWith("-") ? "-" : "";
  const [whole, fraction = "", ...rest] = text.slice(sign.length).split(".");
  if (rest.length > 0 || !allDigits(whole) || (fraction !== "" && !allDigits(fraction))) {
    return null;
  }
  return { sign, whole: String(BigInt(whole)), fraction };
}

/** "5" from "500", "" from "000" @param {string} fraction */
function trimZeros(fraction) {
  let end = fraction.length;
  while (end > 0 && fraction[end - 1] === "0") {
    end -= 1;
  }
  return fraction.slice(0, end);
}

/**
 * @param {string} sign
 * @param {string} whole digits, no leading zeros
 * @param {string} fraction
 */
function join(sign, whole, fraction) {
  const groups = [];
  for (let end = whole.length; end > 0; end -= 3) {
    groups.unshift(whole.slice(Math.max(0, end - 3), end));
  }
  const decimals = fraction === "" ? "" : "." + fraction;
  const shown = sign === "-" && whole === "0" && fraction === "" ? "" : sign;
  return shown + groups.join(",") + decimals;
}
