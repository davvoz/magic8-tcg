/**
 * Ranked settings from data/ranked/ranked.json, validated when the server
 * starts: seasons (ratings start over with each one), who may play ranked,
 * and the fair-play limits.
 */
import { Issues, checkArrayOf, checkInteger, checkObject, checkString } from "@magic8/engine/shared/validation.js";
import { fail, ok } from "@magic8/engine/shared/Result.js";

const TOP_KEYS = Object.freeze(["v", "seasons", "eligibility", "fairPlay"]);
const SEASON_KEYS = Object.freeze(["id", "name", "startsAt"]);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * @typedef {Readonly<{ id: string, name: string, startsAt: number }>} Season
 * @typedef {Readonly<{
 *   seasons: readonly Season[],
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
      if (id === undefined || name === undefined) {
        return undefined;
      }
      return Object.freeze({ id, name, startsAt: startsAt === undefined ? Number.NaN : Date.parse(startsAt) });
    },
  });
  const eligibility = integers(issues, top.eligibility, "ranked.eligibility", ["minFinishedCasualGames"]);
  const fairPlay = integers(issues, top.fairPlay, "ranked.fairPlay", ["maxRatedGamesPerPairPerDay", "earlyConcedeTurn", "earlyConcedesToFlag", "earlyConcedeWindowDays"]);
  const ordered = (seasons ?? []).every((season, index, all) => index === 0 || season.startsAt > all[index - 1].startsAt);
  if (!ordered) {
    issues.add("ranked.seasons", "must start in increasing order");
  }
  if (!issues.isEmpty || seasons === undefined || eligibility === undefined || fairPlay === undefined) {
    return fail("VALIDATION", issues.list()[0], { problems: issues.list() });
  }
  return ok(Object.freeze({ seasons: Object.freeze(seasons), eligibility: Object.freeze(eligibility), fairPlay: Object.freeze(fairPlay) }));
}

/**
 * The season running at `at`, or null before the first one.
 * @param {RankedSettings} settings
 * @param {number} at
 * @returns {Season | null}
 */
export function seasonAt(settings, at) {
  let current = null;
  for (const season of settings.seasons) {
    if (season.startsAt <= at) {
      current = season;
    }
  }
  return current;
}
