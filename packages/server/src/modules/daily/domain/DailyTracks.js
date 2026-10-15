/**
 * The two ways to play a day's challenges (docs/tcg/24-sfide.md): Normal,
 * for a Core Mini Booster, and Hard, for a Core Booster against stronger
 * AIs. A track is the search AI's level for each of the three challenges
 * (two characters, then the boss) and the pack it pays. Data
 * (data/daily/tracks.json), validated at startup against the difficulty
 * scale and the shop's drop tables.
 */
import { MAX_LEVEL, MIN_LEVEL } from "@magic8/engine/domain/ai/search/DifficultyScale.js";
import { Issues, checkArray, checkInteger, checkObject, checkString } from "@magic8/engine/shared/validation.js";

export const TrackId = Object.freeze({ NORMAL: "normal", HARD: "hard" });
export const TRACK_IDS = Object.freeze(Object.values(TrackId));
/** Challenges a day: two characters, then the boss. */
export const CHALLENGES_PER_DAY = 3;

/**
 * @typedef {Readonly<{ id: string, name: string, levels: readonly number[], reward: string }>} Track
 *   `levels`: the AI's level in each challenge, in order; `reward`: the drop table of the pack won
 */

const FILE_KEYS = Object.freeze(["schemaVersion", "tracks"]);
const TRACK_KEYS = Object.freeze(["name", "levels", "reward"]);

export class DailyTracks {
  /** @type {ReadonlyMap<string, Track>} */
  #tracks;

  /** @param {readonly Track[]} tracks */
  constructor(tracks) {
    this.#tracks = new Map(tracks.map((track) => [track.id, track]));
  }

  /**
   * @param {string} id
   * @returns {Track | undefined}
   */
  get(id) {
    return this.#tracks.get(id);
  }

  /** @returns {readonly Track[]} */
  all() {
    return Object.freeze([...this.#tracks.values()]);
  }
}

/**
 * @param {unknown} raw
 * @param {{ hasDropTable: (id: string) => boolean }} economy
 * @returns {import("@magic8/engine/shared/Result.js").Ok<DailyTracks> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function validateDailyTracks(raw, { hasDropTable }) {
  const issues = new Issues();
  const object = checkObject(issues, raw, "tracks", FILE_KEYS);
  if (object === undefined) {
    return issues.toResult(undefined);
  }
  checkInteger(issues, object.schemaVersion, "tracks.schemaVersion", { min: 1, max: 1 });
  const byId = checkObject(issues, object.tracks, "tracks.tracks", TRACK_IDS);
  if (byId === undefined) {
    return issues.toResult(undefined);
  }
  const tracks = TRACK_IDS.map((id) => trackOf(issues, byId[id], { id, path: `tracks.tracks.${id}`, hasDropTable }));
  return issues.toResult(tracks.includes(undefined) ? undefined : new DailyTracks(/** @type {Track[]} */ (tracks)));
}

/**
 * @param {Issues} issues
 * @param {unknown} raw
 * @param {{ id: string, path: string, hasDropTable: (id: string) => boolean }} context
 * @returns {Track | undefined}
 */
function trackOf(issues, raw, { id, path, hasDropTable }) {
  const object = checkObject(issues, raw, path, TRACK_KEYS);
  if (object === undefined) {
    return undefined;
  }
  const name = checkString(issues, object.name, `${path}.name`, { minLength: 1, maxLength: 20 });
  const levels = checkArray(issues, object.levels, `${path}.levels`, { minLength: CHALLENGES_PER_DAY, maxLength: CHALLENGES_PER_DAY });
  levels?.forEach((level, index) => {
    if (typeof level !== "number" || !Number.isFinite(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
      issues.add(`${path}.levels[${index}]`, `expected a level from ${MIN_LEVEL} to ${MAX_LEVEL}`);
    }
  });
  const reward = checkString(issues, object.reward, `${path}.reward`, { minLength: 1, maxLength: 64 });
  if (reward !== undefined && !hasDropTable(reward)) {
    issues.add(`${path}.reward`, `"${reward}" is not a drop table`);
  }
  if (name === undefined || levels === undefined || reward === undefined) {
    return undefined;
  }
  return Object.freeze({ id, name, levels: Object.freeze(/** @type {number[]} */ ([...levels])), reward });
}
