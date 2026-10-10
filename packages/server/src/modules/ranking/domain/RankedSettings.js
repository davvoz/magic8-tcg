/**
 * Ranked settings from data/ranked/ranked.json, validated when the server
 * starts: seasons (ratings start over with each one), who may play ranked,
 * and the fair-play limits.
 *
 * A season runs from `startsAt` until its `endsAt`, or else until the next
 * season starts (the last one without `endsAt` never ends). Between a season
 * that ended and the next one, no season runs: ranked play is closed. A
 * season may name a prize pool (`prizePool`), an entry of `prizePools`: the
 * jackpot module validates those and pays them. A season may charge an entry
 * fee (`entryFee`): the entries each player spends on a ranked game, bought in
 * the shop (the entries module); without it ranked play is free. Auto games
 * (docs/tcg/23-automatica.md) move ratings by `auto.ratingWeightPercent` of
 * what a game played by hand would (20 when left out).
 *
 * The seasons of the file are only the first calendar: the server copies them
 * into the database once, then operators change the calendar from the admin
 * page (SeasonCalendar). What may change depends on the season's phase
 * (checkSeasonChange): an upcoming season anything, a running one its name
 * and its end, an ended one nothing, so no rating or jackpot is rewritten.
 */
import { Issues, allDefined, checkArrayOf, checkInteger, checkObject, checkString } from "@magic8/engine/shared/validation.js";
import { fail, ok } from "@magic8/engine/shared/Result.js";

const TOP_KEYS = Object.freeze(["v", "seasons", "prizePools", "eligibility", "fairPlay", "auto"]);
/** The share of a Glicko-2 change an auto game applies when ranked.json does not say. */
export const DEFAULT_AUTO_RATING_WEIGHT_PERCENT = 20;
const SEASON_KEYS = Object.freeze(["id", "name", "startsAt", "endsAt", "prizePool", "entryFee"]);
/** Most entries one ranked game may cost. */
export const MAX_ENTRY_FEE = 100;
export const MAX_SEASON_NAME_LENGTH = 64;
export const SEASON_ID = /^[a-z0-9-]{1,32}$/;
const POOL_ID = /^[a-z0-9-]{1,32}$/;
const MAX_SEASONS = 1000;

/** Where a season is at a given time. */
export const SeasonPhase = Object.freeze({ UPCOMING: "upcoming", RUNNING: "running", ENDED: "ended" });
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * @typedef {Readonly<{ id: string, name: string, startsAt: number, endsAt: number | null, prizePool: string | null, entryFee: number }>} Season `endsAt` as written in the data (see seasonEnd); `prizePool` an id of `prizePools`;
 *   `entryFee` the entries a ranked game costs each player (0: free)
 * @typedef {Readonly<{
 *   seasons: readonly Season[],
 *   prizePools: unknown,
 *   eligibility: Readonly<{ minFinishedCasualGames: number }>,
 *   fairPlay: Readonly<{ maxRatedGamesPerPairPerDay: number, earlyConcedeTurn: number, earlyConcedesToFlag: number, earlyConcedeWindowDays: number }>,
 *   auto: Readonly<{ ratingWeightPercent: number }>,
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
  const seasons = checkArrayOf(issues, top.seasons, "ranked.seasons", { minLength: 1, maxLength: MAX_SEASONS, item: (item, path) => checkSeason(issues, item, path) });
  checkCalendar(issues, seasons ?? [], "ranked.seasons");
  const eligibility = integers(issues, top.eligibility, "ranked.eligibility", ["minFinishedCasualGames"]);
  const fairPlay = integers(issues, top.fairPlay, "ranked.fairPlay", ["maxRatedGamesPerPairPerDay", "earlyConcedeTurn", "earlyConcedesToFlag", "earlyConcedeWindowDays"]);
  const auto = checkAuto(issues, top.auto);
  if (!issues.isEmpty || seasons === undefined || eligibility === undefined || fairPlay === undefined || auto === undefined) {
    return fail("VALIDATION", issues.list()[0], { problems: issues.list() });
  }
  return ok(Object.freeze({ seasons: Object.freeze(seasons), prizePools: top.prizePools ?? null, eligibility: Object.freeze(eligibility), fairPlay: Object.freeze(fairPlay), auto }));
}

/**
 * The auto-game settings; left out, the defaults.
 * @param {Issues} issues
 * @param {unknown} value
 * @returns {Readonly<{ ratingWeightPercent: number }> | undefined}
 */
function checkAuto(issues, value) {
  if (value === undefined) {
    return Object.freeze({ ratingWeightPercent: DEFAULT_AUTO_RATING_WEIGHT_PERCENT });
  }
  const auto = checkObject(issues, value, "ranked.auto", ["ratingWeightPercent"]);
  const ratingWeightPercent = auto === undefined ? undefined : checkInteger(issues, auto.ratingWeightPercent, "ranked.auto.ratingWeightPercent", { min: 1, max: 100 });
  return ratingWeightPercent === undefined ? undefined : Object.freeze({ ratingWeightPercent });
}

/**
 * One season, as the data file and the admin page write it: times in UTC to the second (`2026-10-08T00:00:00Z`),
 * no `endsAt` (or null) for a season that ends when the next one starts, no `prizePool` (or null) for none.
 * @param {Issues} issues
 * @param {unknown} value
 * @param {string} path
 * @returns {Season | undefined}
 */
export function checkSeason(issues, value, path) {
  const problems = issues.count;
  const season = checkObject(issues, value, path, SEASON_KEYS);
  if (season === undefined) {
    return undefined;
  }
  const fields = allDefined({
    id: checkString(issues, season.id, `${path}.id`, { pattern: SEASON_ID }),
    name: checkString(issues, season.name, `${path}.name`, { minLength: 1, maxLength: MAX_SEASON_NAME_LENGTH }),
    startsAt: checkTime(issues, season.startsAt, `${path}.startsAt`),
    endsAt: optional(season.endsAt, (given) => checkTime(issues, given, `${path}.endsAt`)),
    prizePool: optional(season.prizePool, (given) => checkString(issues, given, `${path}.prizePool`, { pattern: POOL_ID })),
    entryFee: season.entryFee === undefined ? 0 : checkInteger(issues, season.entryFee, `${path}.entryFee`, { min: 0, max: MAX_ENTRY_FEE }),
  });
  // Unknown fields are reported without stopping the checks: any problem refuses the season.
  return issues.count > problems || fields === undefined ? undefined : Object.freeze(fields);
}

/**
 * A field that may be left out or null.
 * @template T
 * @param {unknown} value
 * @param {(value: unknown) => T} check
 * @returns {T | null}
 */
const optional = (value, check) => (value === undefined || value === null ? null : check(value));

/**
 * @param {Issues} issues
 * @param {unknown} value
 * @param {string} path
 * @returns {number | undefined}
 */
function checkTime(issues, value, path) {
  const text = checkString(issues, value, path, { pattern: ISO_UTC });
  if (text === undefined) {
    return undefined;
  }
  const time = Date.parse(text);
  return Number.isNaN(time) ? issues.add(path, "not a real date") : time;
}

/**
 * A calendar: distinct ids, seasons starting in increasing order, each ending after it starts and no later than the next one starts.
 * @param {Issues} issues
 * @param {readonly Season[]} seasons
 * @param {string} path
 */
export function checkCalendar(issues, seasons, path) {
  if (new Set(seasons.map((season) => season.id)).size !== seasons.length) {
    issues.add(path, "season ids must be distinct");
  }
  seasons.forEach((season, index) => {
    const next = seasons[index + 1];
    if (next !== undefined && next.startsAt <= season.startsAt) {
      issues.add(path, "must start in increasing order");
    }
    if (season.endsAt !== null && !(season.endsAt > season.startsAt && (next === undefined || season.endsAt <= next.startsAt))) {
      issues.add(`${path}[${index}].endsAt`, "must be after its start and no later than the next season's start");
    }
  });
}

/**
 * Whether an operator may make a change to the calendar at `now`: create a season (`before` null), change one, or
 * delete one (`after` null). A season is created or deleted only before it starts; once it runs, only its name and
 * its end change (the end stays in the future); once it has ended, nothing. The calendar it makes is checked apart.
 * @param {RankedSettings} settings the calendar before the change
 * @param {Season | null} before
 * @param {Season | null} after
 * @param {number} now
 * @returns {string | null} why not, or null
 */
export function checkSeasonChange(settings, before, after, now) {
  if (before === null) {
    return after !== null && after.startsAt <= now ? "a new season must start in the future" : null;
  }
  const phase = seasonPhase(settings, before, now);
  if (phase === SeasonPhase.ENDED) {
    return "a season that has ended cannot change";
  }
  if (phase === SeasonPhase.UPCOMING) {
    return after !== null && after.startsAt <= now ? "the season must start in the future" : null;
  }
  return checkRunningChange(before, after, now);
}

/**
 * @param {Season} before a running season
 * @param {Season | null} after
 * @param {number} now
 * @returns {string | null}
 */
function checkRunningChange(before, after, now) {
  if (after === null) {
    return "a season that has started cannot be deleted";
  }
  if (after.startsAt !== before.startsAt || after.entryFee !== before.entryFee || after.prizePool !== before.prizePool) {
    return "a running season can change only its name and its end";
  }
  return after.endsAt !== null && after.endsAt <= now ? "a running season must end in the future" : null;
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
  // By id: the calendar may have changed since `season` was read from it.
  const index = settings.seasons.findIndex((candidate) => candidate.id === season.id);
  const next = index === -1 ? undefined : settings.seasons[index + 1];
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
