/**
 * Ranked settings from data/ranked/ranked.json, validated when the server
 * starts: seasons (ratings start over with each one), who may play ranked,
 * and the fair-play limits.
 *
 * A season runs from `startsAt` until its `endsAt`, or else until the next
 * season starts (the last one without `endsAt` never ends). Between a season
 * that ended and the next one, no season runs: ranked play is closed. A
 * season may name a prize pool (`prizePool`), an entry of `prizePools`: the
 * jackpot module validates those and pays them.
 */
import { Issues, checkArrayOf, checkInteger, checkObject, checkString } from "@magic8/engine/shared/validation.js";
import { fail, ok } from "@magic8/engine/shared/Result.js";

const TOP_KEYS = Object.freeze(["v", "seasons", "prizePools", "eligibility", "fairPlay"]);
const SEASON_KEYS = Object.freeze(["id", "name", "startsAt", "endsAt", "prizePool"]);
const POOL_ID = /^[a-z0-9-]{1,32}$/;

/** Where a season is at a given time. */
export const SeasonPhase = Object.freeze({ UPCOMING: "upcoming", RUNNING: "running", ENDED: "ended" });
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * @typedef {Readonly<{ id: string, name: string, startsAt: number, endsAt: number | null, prizePool: string | null }>} Season `endsAt` as written in the data (see seasonEnd); `prizePool` an id of `prizePools`
 * @typedef {Readonly<{
 *   seasons: readonly Season[],
 *   prizePools: unknown,
 *   eligibility: Readonly<{ minFinishedCasualGames: number }>,
 *   fairPlay: Readonly<{ maxRatedGamesPerPairPerDay: number, earlyConcedeTurn: number, earlyConcedesToFlag: number, earlyConcedeWindowDays: number }>,
 * }>} RankedSettings
 */

/**
 * @param {Issues} issues
 * @param {unknown} value
 * @param {string} path
 * @template {string} K
 * @param {readonly K[]} keys
 * @returns {Record<K, number> | undefined}
 */
function integers(issues, value, path, keys) {
  const object = checkObject(issues, value, path, keys);
  if (object === undefined) {
    return undefined;
  }
  return /** @type {Record<K, number>} */ (Object.fromEntries(keys.map((key) => [key, checkInteger(issues, object[key], `${path}.${key}`, { min: 0, max: 1_000_000 })])));
}

/**
 * @param {unknown} raw
 * @returns {import("@magic8/engine/shared/Result.js").Ok<RankedSettings> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function validateRankedSettings(raw) {
  const issues = new Issues();
  const top = checkObject(issues, raw, "ranked", TOP_KEYS);
  if (top === undefined) {
    return fail("VALIDATION", issues.list()[0], { problems: issues.list() });
  }
  checkInteger(issues, top.v, "ranked.v", { min: 1, max: 1 });
  const seasons = checkArrayOf(issues, top.seasons, "ranked.seasons", {
    minLength: 1,
    maxLength: 1000,
    item: (item, path) => {
      const season = checkObject(issues, item, path, SEASON_KEYS);
      if (season === undefined) {
        return undefined;
      }
      const id = checkString(issues, season.id, `${path}.id`, { pattern: /^[a-z0-9-]{1,32}$/ });
      const name = checkString(issues, season.name, `${path}.name`, { minLength: 1, maxLength: 64 });
      const startsAt = checkString(issues, season.startsAt, `${path}.startsAt`, { pattern: ISO_UTC });
      const endsAt = season.endsAt === undefined ? null : checkString(issues, season.endsAt, `${path}.endsAt`, { pattern: ISO_UTC });
      const prizePool = season.prizePool === undefined ? null : checkString(issues, season.prizePool, `${path}.prizePool`, { pattern: POOL_ID });
      if (id === undefined || name === undefined || endsAt === undefined || prizePool === undefined) {
        return undefined;
      }
      return Object.freeze({ id, name, startsAt: startsAt === undefined ? Number.NaN : Date.parse(startsAt), endsAt: endsAt === null ? null : Date.parse(endsAt), prizePool });
    },
  });
  checkSeasonTimes(issues, seasons ?? []);
  const eligibility = integers(issues, top.eligibility, "ranked.eligibility", ["minFinishedCasualGames"]);
  const fairPlay = integers(issues, top.fairPlay, "ranked.fairPlay", ["maxRatedGamesPerPairPerDay", "earlyConcedeTurn", "earlyConcedesToFlag", "earlyConcedeWindowDays"]);
  if (!issues.isEmpty || seasons === undefined || eligibility === undefined || fairPlay === undefined) {
    return fail("VALIDATION", issues.list()[0], { problems: issues.list() });
  }
  return ok(Object.freeze({ seasons: Object.freeze(seasons), prizePools: top.prizePools ?? null, eligibility: Object.freeze(eligibility), fairPlay: Object.freeze(fairPlay) }));
}

/**
 * Seasons start in increasing order, and one ends after it starts and before the next one starts.
 * @param {Issues} issues
 * @param {readonly Season[]} seasons
 */
function checkSeasonTimes(issues, seasons) {
  seasons.forEach((season, index) => {
    const next = seasons[index + 1];
    if (next !== undefined && next.startsAt <= season.startsAt) {
      issues.add("ranked.seasons", "must start in increasing order");
    }
    if (season.endsAt !== null && !(season.endsAt > season.startsAt && (next === undefined || season.endsAt <= next.startsAt))) {
      issues.add(`ranked.seasons[${index}].endsAt`, "must be after its start and no later than the next season's start");
    }
  });
}

/**
 * When a season ends: its `endsAt`, else the next season's start; null for a last season that never ends.
 * @param {RankedSettings} settings
 * @param {Season} season
 * @returns {number | null}
 */
export function seasonEnd(settings, season) {
  if (season.endsAt !== null) {
    return season.endsAt;
  }
  const next = settings.seasons[settings.seasons.indexOf(season) + 1];
  return next === undefined ? null : next.startsAt;
}

/**
 * @param {RankedSettings} settings
 * @param {Season} season
 * @param {number} at
 * @returns {typeof SeasonPhase[keyof typeof SeasonPhase]}
 */
export function seasonPhase(settings, season, at) {
  if (at < season.startsAt) {
    return SeasonPhase.UPCOMING;
  }
  const end = seasonEnd(settings, season);
  return end === null || at < end ? SeasonPhase.RUNNING : SeasonPhase.ENDED;
}

/**
 * The season running at `at`, or null before the first one and between a season that ended and the next.
 * @param {RankedSettings} settings
 * @param {number} at
 * @returns {Season | null}
 */
export function seasonAt(settings, at) {
  return settings.seasons.find((season) => seasonPhase(settings, season, at) === SeasonPhase.RUNNING) ?? null;
}
