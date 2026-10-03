/**
 * A season's prize pool (data/ranked/ranked.json, `prizePools`): a share of
 * what the bank's wallet holds of one asset, split among the first places
 * of the season's leaderboard by percentage. The bank is the shop account of
 * the pool's network: every pack sold pays into it, so the jackpot grows
 * while the season runs.
 *
 * Amounts are integer units of the asset (thousandths of a STEEM). Shares are
 * rounded down; the last place takes what rounding leaves, so the places
 * always add up to the jackpot exactly.
 */
import { Issues, allDefined, checkArrayOf, checkInteger, checkObject, checkString } from "@magic8/engine/shared/validation.js";
import { fail, ok } from "@magic8/engine/shared/Result.js";

const POOL_KEYS = Object.freeze(["network", "asset", "share", "places", "settleAfterMinutes"]);
const SHARE_KEYS = Object.freeze(["numerator", "denominator"]);
const POOL_ID = /^[a-z0-9-]{1,32}$/;
const MINUTE_MS = 60_000;
const MAX_PLACES = 10;

/** @typedef {Readonly<{ place: number, percent: number, amount: number }>} PlaceShare */

export class PrizePool {
  /**
   * @param {{ id: string, network: string, asset: string, numerator: number, denominator: number, percents: readonly number[], settleAfterMs: number }} definition
   */
  constructor({ id, network, asset, numerator, denominator, percents, settleAfterMs }) {
    this.id = id;
    this.network = network;
    this.asset = asset;
    this.share = Object.freeze({ numerator, denominator });
    this.percents = Object.freeze([...percents]);
    /** How long after the season ends its result is final: games that ended in time are all rated by then. */
    this.settleAfterMs = settleAfterMs;
    Object.freeze(this);
  }

  /** How many places win something. */
  get places() {
    return this.percents.length;
  }

  /**
   * The jackpot when the bank holds `balance` units.
   * @param {number} balance
   */
  jackpotOf(balance) {
    return Number((BigInt(balance) * BigInt(this.share.numerator)) / BigInt(this.share.denominator));
  }

  /**
   * What each place wins of `jackpot` units, first place first.
   * @param {number} jackpot
   * @returns {readonly PlaceShare[]}
   */
  split(jackpot) {
    let left = jackpot;
    return Object.freeze(
      this.percents.map((percent, index) => {
        const amount = index === this.percents.length - 1 ? left : Math.floor((jackpot * percent) / 100);
        left -= amount;
        return Object.freeze({ place: index + 1, percent, amount });
      }),
    );
  }
}

/**
 * Validates `prizePools` against the seasons that name them.
 * @param {unknown} raw the `prizePools` object, or null when there is none
 * @param {readonly { id: string, endsAt: number | null, prizePool: string | null }[]} seasons
 * @returns {import("@magic8/engine/shared/Result.js").Ok<ReadonlyMap<string, PrizePool>> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function validatePrizePools(raw, seasons) {
  const issues = new Issues();
  /** @type {Map<string, PrizePool>} */
  const pools = new Map();
  const object = raw === null ? {} : checkObject(issues, raw, "ranked.prizePools");
  for (const [id, value] of Object.entries(object ?? {})) {
    if (!POOL_ID.test(id)) {
      issues.add(`ranked.prizePools.${id}`, "ids are lowercase letters, digits and '-'");
      continue;
    }
    const pool = validatePool(issues, value, `ranked.prizePools.${id}`, id);
    if (pool !== undefined) {
      pools.set(id, pool);
    }
  }
  for (const season of seasons.filter((candidate) => candidate.prizePool !== null)) {
    if (!pools.has(/** @type {string} */ (season.prizePool)) && object !== undefined) {
      issues.add(`ranked.seasons.${season.id}.prizePool`, `no prize pool "${season.prizePool}"`);
    }
    if (season.endsAt === null) {
      issues.add(`ranked.seasons.${season.id}.endsAt`, "a season with a prize pool needs an end");
    }
  }
  return issues.isEmpty ? ok(/** @type {ReadonlyMap<string, PrizePool>} */ (pools)) : fail("VALIDATION", issues.list()[0], { problems: issues.list() });
}

/**
 * @param {Issues} issues
 * @param {unknown} value
 * @param {string} path
 * @param {string} id
 * @returns {PrizePool | undefined}
 */
function validatePool(issues, value, path, id) {
  const pool = checkObject(issues, value, path, POOL_KEYS);
  if (pool === undefined) {
    return undefined;
  }
  const fields = allDefined({
    network: checkString(issues, pool.network, `${path}.network`, { pattern: /^[a-z]{1,16}$/ }),
    asset: checkString(issues, pool.asset, `${path}.asset`, { pattern: /^[A-Z]{1,10}$/ }),
    share: validateShare(issues, pool.share, `${path}.share`),
    percents: checkArrayOf(issues, pool.places, `${path}.places`, { minLength: 1, maxLength: MAX_PLACES, item: (item, itemPath) => checkInteger(issues, item, itemPath, { min: 1, max: 100 }) }),
    settleAfter: checkInteger(issues, pool.settleAfterMinutes, `${path}.settleAfterMinutes`, { min: 0, max: 7 * 24 * 60 }),
  });
  if (fields !== undefined && fields.percents.reduce((sum, percent) => sum + percent, 0) !== 100) {
    issues.add(`${path}.places`, "the percentages must add up to 100");
  }
  if (fields === undefined) {
    return undefined;
  }
  const { network, asset, share, percents, settleAfter } = fields;
  return new PrizePool({ id, network, asset, ...share, percents, settleAfterMs: settleAfter * MINUTE_MS });
}

/**
 * A fraction of the wallet, at most all of it.
 * @param {Issues} issues
 * @param {unknown} value
 * @param {string} path
 * @returns {{ numerator: number, denominator: number } | undefined}
 */
function validateShare(issues, value, path) {
  const share = checkObject(issues, value, path, SHARE_KEYS);
  if (share === undefined) {
    return undefined;
  }
  const numerator = checkInteger(issues, share.numerator, `${path}.numerator`, { min: 1, max: 1000 });
  const denominator = checkInteger(issues, share.denominator, `${path}.denominator`, { min: 1, max: 1000 });
  if (numerator === undefined || denominator === undefined) {
    return undefined;
  }
  if (numerator > denominator) {
    return issues.add(path, "cannot be more than the whole wallet");
  }
  return { numerator, denominator };
}
