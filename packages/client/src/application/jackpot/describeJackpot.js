/**
 * What the screens say about the season's jackpot: the amount, how it is
 * split, who holds each place, how long the season has left, and that the
 * jackpot grows with the bank. Pure, so the menu and the leaderboard word it
 * the same way, and the countdown is worked out again each second from the
 * time alone.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ORDINALS = Object.freeze(["1st", "2nd", "3rd"]);
const PAID_TEXT = Object.freeze({ PENDING: "to be paid", SENT: "sent", CONFIRMED: "paid" });

/**
 * @typedef {Readonly<{ label: string, share: string, amount: string, figure: string, holder: string, account: string | null, note: string }>} PlaceText
 *   `figure` the amount without the asset ("563.332")
 *   `holder` who holds (or won) the place, or what it means that nobody does; `note` the payment's state once settled
 * @typedef {Readonly<{ title: string, amount: string, asset: string, countdown: string, source: string, pitch: string, growth: string | null, places: readonly PlaceText[], ticking: boolean }>} JackpotText
 *   `pitch` the source in a few words, for a single line; `ticking`: the countdown changes with time
 */

/**
 * @param {import("../ports/JackpotApi.contract.js").Jackpot} jackpot
 * @param {number} now
 * @returns {JackpotText}
 */
export function describeJackpot(jackpot, now) {
  const { season, asset } = jackpot;
  const settled = season.status === "settled";
  const amount = jackpot.jackpot === null ? `— ${asset}` : `${jackpot.jackpot} ${asset}`;
  const growth = settled ? null : growthText(jackpot);
  return Object.freeze({
    title: settled ? `${season.name} jackpot · final` : `${season.name} jackpot`,
    amount,
    asset,
    countdown: countdownText(jackpot, now),
    source: settled ? `${shareText(jackpot.share)} of @${jackpot.bank}'s wallet when the season ended` : `${shareText(jackpot.share)} of @${jackpot.bank}'s wallet · grows with every pack sold`,
    pitch: settled ? "final" : "grows with every pack sold",
    growth,
    places: Object.freeze(jackpot.places.map((place) => placeText(place, asset, season.status))),
    ticking: season.status === "upcoming" || season.status === "running",
  });
}

/**
 * How long the season has left (or until it starts), to the second.
 * @param {import("../ports/JackpotApi.contract.js").Jackpot} jackpot
 * @param {number} now
 */
export function countdownText({ season }, now) {
  if (season.status === "upcoming") {
    return now < season.startsAt ? `Starts in ${formatDuration(season.startsAt - now)}` : "Starting…";
  }
  if (season.status === "running") {
    return now < season.endsAt ? `Ends in ${formatDuration(season.endsAt - now)}` : "Ending…";
  }
  return season.status === "settling" ? "Season over · final results soon" : "Season over";
}

/**
 * "12d 04h 31m 08s", "04h 31m 08s", "31m 08s" or "08s".
 * @param {number} milliseconds
 */
export function formatDuration(milliseconds) {
  const total = Math.max(0, Math.ceil(milliseconds / SECOND) * SECOND);
  const days = Math.floor(total / DAY);
  /** @type {[number, string][]} */
  const parts = [[Math.floor((total % DAY) / HOUR), "h"], [Math.floor((total % HOUR) / MINUTE), "m"], [Math.floor((total % MINUTE) / SECOND), "s"]];
  const shown = days > 0 ? parts : parts.slice(parts.findIndex(([value], index) => value > 0 || index === parts.length - 1));
  const clock = shown.map(([value, unit]) => `${String(value).padStart(2, "0")}${unit}`).join(" ");
  return days > 0 ? `${days}d ${clock}` : clock;
}

/** "2/3" @param {{ numerator: number, denominator: number }} share */
const shareText = ({ numerator, denominator }) => `${numerator}/${denominator}`;

/**
 * "+200.000 STEEM since the season began", when it has grown.
 * @param {import("../ports/JackpotApi.contract.js").Jackpot} jackpot
 */
function growthText({ jackpot, opening, asset, season }) {
  if (jackpot === null || opening === null || season.status === "upcoming") {
    return null;
  }
  const decimals = jackpot.split(".")[1]?.length ?? 0;
  const grown = unitsOf(jackpot, decimals) - unitsOf(opening, decimals);
  return grown > 0n ? `+${formatUnits(grown, decimals)} ${asset} since the season began` : null;
}

/**
 * @param {import("../ports/JackpotApi.contract.js").JackpotPlace} place
 * @param {string} asset
 * @param {string} status
 * @returns {PlaceText}
 */
function placeText(place, asset, status) {
  const holder = place.account === null ? emptyPlace(status) : `@${place.account}`;
  return Object.freeze({
    label: ORDINALS[place.place - 1] ?? `${place.place}th`,
    share: `${place.percent}%`,
    amount: place.amount === null ? `— ${asset}` : `${place.amount} ${asset}`,
    figure: place.amount ?? "—",
    holder,
    account: place.account,
    note: place.paid === null ? "" : PAID_TEXT[place.paid],
  });
}

/** @param {string} status */
function emptyPlace(status) {
  if (status === "upcoming") {
    return "the season has not started";
  }
  return status === "settled" ? "nobody · stays in the bank" : "nobody yet · it could be you";
}

/**
 * @param {string} amount "866.666"
 * @param {number} decimals
 */
function unitsOf(amount, decimals) {
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0").slice(0, decimals) || "0");
}

/**
 * @param {bigint} units
 * @param {number} decimals
 */
function formatUnits(units, decimals) {
  if (decimals === 0) {
    return units.toString();
  }
  const digits = units.toString().padStart(decimals + 1, "0");
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}
