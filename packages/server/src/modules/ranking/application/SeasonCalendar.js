/**
 * SeasonCalendar: the ranked seasons, kept in the database and changed by
 * operators from the admin page (docs/tcg/09-classificata.md).
 *
 * - The first time the server starts on an empty calendar it copies the
 *   seasons of data/ranked/ranked.json; from then on the file's seasons are
 *   not read again.
 * - Every process keeps the calendar in memory (`settings`, what the ranking
 *   and jackpot services read). It reads it at start and again whenever the
 *   seasons channel says it changed, whoever changed it.
 * - A change is checked against the whole calendar it makes (order, ends,
 *   prize pools that exist and seasons with a pool that end) and against the
 *   season's phase: an upcoming season changes freely, a running one only its
 *   name and end, an ended one never. Changes happen one at a time, and each
 *   is audited with who made it.
 */
import { Issues } from "@magic8/engine/shared/validation.js";
import { AppError } from "../../../kernel/AppError.js";
import { checkCalendar, checkSeasonChange, seasonEnd, seasonPhase } from "../domain/RankedSettings.js";

/** The channel NOTIFY uses when the calendar changes. */
export const SEASONS_CHANNEL = "m8_seasons";

/**
 * @typedef {import("../domain/RankedSettings.js").Season} Season
 * @typedef {import("../domain/RankedSettings.js").RankedSettings} RankedSettings
 * @typedef {Readonly<{ userId?: string | null, ip?: string | null }>} Operator
 */

export class SeasonCalendar {
  #repository;
  #initial;
  #poolIds;
  #checkPools;
  #publish;
  #listen;
  #audit;
  #clock;
  #unitOfWork;
  #logger;
  /** @type {readonly Season[]} */
  #seasons = Object.freeze([]);
  /** The ranked settings with the calendar as it is now: what the ranking and jackpot services read. @type {RankedSettings} */
  settings;

  /**
   * @param {{
   *   repository: import("../infrastructure/PgSeasonRepository.js").PgSeasonRepository,
   *   initial: RankedSettings,
   *   poolIds: readonly string[],
   *   checkPools: (seasons: readonly Season[]) => string | null,
   *   publish: (channel: string, payload: string) => Promise<unknown>,
   *   listen: (channel: string, onPayload: (payload: string) => void, options: { onReconnect: () => void }) => Promise<() => Promise<void>>,
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   clock: import("../../../kernel/time.js").Clock,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   logger: import("../../../kernel/logger.js").Logger,
   * }} deps `initial`: the data file's settings; `poolIds`: the prize pools a season may name;
   *   `checkPools`: why a calendar's prize pools are wrong, or null
   */
  constructor({ repository, initial, poolIds, checkPools, publish, listen, audit, clock, unitOfWork, logger }) {
    this.#repository = repository;
    this.#initial = initial;
    this.#poolIds = Object.freeze([...poolIds]);
    this.#checkPools = checkPools;
    this.#publish = publish;
    this.#listen = listen;
    this.#audit = audit;
    this.#clock = clock;
    this.#unitOfWork = unitOfWork;
    this.#logger = logger;
    const calendar = this;
    this.settings = Object.freeze({
      get seasons() {
        return calendar.#seasons;
      },
      prizePools: initial.prizePools,
      eligibility: initial.eligibility,
      fairPlay: initial.fairPlay,
    });
  }

  /** The seasons in the order they start. */
  get seasons() {
    return this.#seasons;
  }

  /** Reads the calendar, after copying the data file's seasons into an empty one. Fails on a calendar that is not valid. */
  async load() {
    const copied = await this.#unitOfWork(async () => {
      await this.#repository.lock();
      if ((await this.#repository.all()).length > 0) {
        return false;
      }
      const at = this.#clock.now();
      for (const season of this.#initial.seasons) {
        await this.#repository.insert(season, at);
      }
      return true;
    });
    if (copied) {
      this.#logger.info("season calendar copied from the data file", { seasons: this.#initial.seasons.length });
    }
    const seasons = await this.#repository.all();
    const problem = this.#problemOf(seasons);
    if (problem !== null) {
      throw new Error(`the season calendar is invalid: ${problem}`);
    }
    this.#seasons = seasons;
  }

  /**
   * Follows the changes made by any process.
   * @returns {Promise<() => Promise<void>>} stop following
   */
  start() {
    const reload = () => {
      this.#repository.all().then(
        (seasons) => {
          this.#seasons = seasons;
        },
        (error) => this.#logger.error("season calendar could not be read", { error: error instanceof Error ? error.message : String(error) }),
      );
    };
    return this.#listen(SEASONS_CHANNEL, reload, { onReconnect: reload });
  }

  /** What operators see: every season with its phase and when it really ends, and the prize pools a season may name. */
  view() {
    const now = this.#clock.now();
    return Object.freeze({
      now: isoUtc(now),
      pools: this.#poolIds,
      seasons: Object.freeze(
        this.#seasons.map((season) => {
          const end = seasonEnd(this.settings, season);
          return Object.freeze({
            id: season.id,
            name: season.name,
            startsAt: isoUtc(season.startsAt),
            endsAt: season.endsAt === null ? null : isoUtc(season.endsAt),
            end: end === null ? null : isoUtc(end),
            prizePool: season.prizePool,
            entryFee: season.entryFee,
            phase: seasonPhase(this.settings, season, now),
          });
        }),
      ),
    });
  }

  /**
   * Adds a season that starts in the future.
   * @param {Operator} operator
   * @param {Season} season
   */
  create(operator, season) {
    return this.#change(operator, null, season, "admin.season_created");
  }

  /**
   * Changes a season: anything before it starts, its name and end while it runs.
   * @param {Operator} operator
   * @param {Season} season the season as it should be, by its id
   */
  update(operator, season) {
    return this.#change(operator, season.id, season, "admin.season_changed");
  }

  /**
   * Deletes a season that has not started.
   * @param {Operator} operator
   * @param {string} id
   */
  remove(operator, id) {
    return this.#change(operator, id, null, "admin.season_deleted");
  }

  /**
   * @param {Operator} operator
   * @param {string | null} id the season changed or deleted; null to create one
   * @param {Season | null} after null to delete it
   * @param {string} action
   */
  async #change({ userId = null, ip = null }, id, after, action) {
    const now = this.#clock.now();
    const target = id ?? /** @type {Season} */ (after).id;
    const seasons = await this.#unitOfWork(async () => {
      await this.#repository.lock();
      const { before, next } = this.#plan(await this.#repository.all(), id, after, now);
      if (before === null) {
        await this.#repository.insert(/** @type {Season} */ (after), now);
      } else if (after === null) {
        await this.#repository.delete(before.id);
      } else {
        await this.#repository.update(after, now);
      }
      await this.#audit.record({ actorKind: "admin", actorUserId: userId, ip, action, targetKind: "season", targetId: target, details: { before: describeSeason(before), after: describeSeason(after) } });
      await this.#publish(SEASONS_CHANNEL, "changed");
      return next;
    });
    this.#seasons = seasons;
    this.#logger.info("season calendar changed", { action, season: target });
    return this.view();
  }

  /**
   * The season a change replaces and the calendar it makes; throws when the change is not allowed.
   * @param {readonly Season[]} current
   * @param {string | null} id
   * @param {Season | null} after
   * @param {number} now
   * @returns {{ before: Season | null, next: readonly Season[] }}
   */
  #plan(current, id, after, now) {
    const before = id === null ? null : (current.find((season) => season.id === id) ?? null);
    if (id !== null && before === null) {
      throw new AppError("NOT_FOUND", "no season with this id");
    }
    if (before === null && current.some((season) => season.id === after?.id)) {
      throw new AppError("CONFLICT", "a season with this id already exists");
    }
    const refused = checkSeasonChange({ ...this.settings, seasons: current }, before, after, now);
    if (refused !== null) {
      throw new AppError("CONFLICT", refused);
    }
    const next = Object.freeze([...current.filter((season) => season.id !== id), ...(after === null ? [] : [after])].sort((a, b) => a.startsAt - b.startsAt));
    if (next.length === 0) {
      throw new AppError("CONFLICT", "the calendar needs at least one season");
    }
    const problem = this.#problemOf(next);
    if (problem !== null) {
      throw new AppError("VALIDATION", problem);
    }
    return { before, next };
  }

  /**
   * Why a calendar is not valid, or null.
   * @param {readonly Season[]} seasons
   * @returns {string | null}
   */
  #problemOf(seasons) {
    const issues = new Issues();
    checkCalendar(issues, seasons, "seasons");
    return issues.isEmpty ? this.#checkPools(seasons) : issues.list()[0];
  }
}

/** @param {number} time */
const isoUtc = (time) => new Date(time).toISOString().replace(".000Z", "Z");

/** @param {Season | null} season */
const describeSeason = (season) => (season === null ? null : { ...season, startsAt: isoUtc(season.startsAt), endsAt: season.endsAt === null ? null : isoUtc(season.endsAt) });
