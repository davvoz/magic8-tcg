/**
 * JackpotService: the prize of a season (docs/tcg/21-stagioni-e-jackpot.md).
 *
 * - While a season with a prize pool runs, its jackpot is the pool's share
 *   of what the bank's wallet holds now: it grows with every pack sold. The
 *   public view reads the wallet at most once a minute, and shows who holds
 *   the winning places right now.
 * - The first time the season is seen running, the bank's balance is kept
 *   as its opening one, so players can see how much the jackpot has grown.
 * - Once the season is over (and a grace period has let every game that
 *   ended in time be rated), it is settled exactly once: the bank's balance
 *   is read, the jackpot frozen and split among the first places of the
 *   leaderboard. Each winner is told, and owed a prize an operator pays
 *   from the bank (PrizePayoutWatcher). Places nobody earned (fewer settled
 *   ratings than places) stay in the bank, for the next season.
 */
import { NotificationKind } from "../../notifications/index.js";
import { SeasonPhase, seasonEnd, seasonPhase } from "../../ranking/index.js";

/** The public view's status of a season: the ranking module's phases, then the two steps after its end. */
export const JackpotStatus = Object.freeze({ UPCOMING: "upcoming", RUNNING: "running", SETTLING: "settling", SETTLED: "settled" });

export const DEFAULT_JACKPOT_POLICY = Object.freeze({
  /** How old the bank's balance may be in the public view. */
  balanceMaxAgeMs: 60_000,
});

/**
 * @typedef {import("../domain/PrizePool.js").PrizePool} PrizePool
 * @typedef {import("../../ranking/domain/RankedSettings.js").Season} Season
 * @typedef {import("../../ranking/index.js").RankingService} RankingService
 * @typedef {Readonly<{ balance: number, readAt: number }>} BalanceReading
 * @typedef {{ jackpot: number | null, readAt: number | null, holders: readonly { place: number, account: string, rating: number, paid: string | null }[] }} Figures
 */

export class JackpotService {
  #settings;
  #pools;
  #bankFor;
  #readBalance;
  #formatAmount;
  #ranking;
  #repository;
  #notifications;
  #audit;
  #clock;
  #unitOfWork;
  #logger;
  #policy;
  /** The last reading of each bank wallet, by "network:account". @type {Map<string, BalanceReading>} */
  #readings = new Map();
  /** A reading on its way, shared by whoever asks meanwhile. @type {Map<string, Promise<BalanceReading | null>>} */
  #reading = new Map();

  /**
   * @param {{
   *   settings: import("../../ranking/domain/RankedSettings.js").RankedSettings,
   *   pools: ReadonlyMap<string, PrizePool>,
   *   bankFor: (network: string) => string,
   *   readBalance: (network: string, account: string, asset: string) => Promise<number | null>,
   *   formatAmount: (units: number, asset: string) => string,
   *   ranking: Pick<RankingService, "podium">,
   *   repository: import("../infrastructure/PgJackpotRepository.js").PgJackpotRepository,
   *   notifications: Pick<import("../../notifications/index.js").NotificationService, "notify">,
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   clock: import("../../../kernel/time.js").Clock,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   logger: import("../../../kernel/logger.js").Logger,
   *   policy?: Partial<typeof DEFAULT_JACKPOT_POLICY>,
   * }} deps `readBalance`: units of `asset` the account holds, null when the chain cannot tell
   */
  constructor({ settings, pools, bankFor, readBalance, formatAmount, ranking, repository, notifications, audit, clock, unitOfWork, logger, policy = {} }) {
    this.#settings = settings;
    this.#pools = pools;
    this.#bankFor = bankFor;
    this.#readBalance = readBalance;
    this.#formatAmount = formatAmount;
    this.#ranking = ranking;
    this.#repository = repository;
    this.#notifications = notifications;
    this.#audit = audit;
    this.#clock = clock;
    this.#unitOfWork = unitOfWork;
    this.#logger = logger;
    this.#policy = { ...DEFAULT_JACKPOT_POLICY, ...policy };
  }

  /** The seasons that have a prize pool, in order. */
  get #prizeSeasons() {
    return this.#settings.seasons.filter((season) => season.prizePool !== null);
  }

  /**
   * @param {Season} season
   * @returns {PrizePool}
   */
  #poolOf(season) {
    return /** @type {PrizePool} validated at start */ (this.#pools.get(/** @type {string} */ (season.prizePool)));
  }

  /**
   * The season the players should look at: the one running, else the next one, else the last one that ended.
   * @param {number} now
   */
  #featured(now) {
    const seasons = this.#prizeSeasons;
    const phase = (/** @type {Season} */ season) => seasonPhase(this.#settings, season, now);
    return seasons.find((season) => phase(season) === SeasonPhase.RUNNING) ?? seasons.find((season) => phase(season) === SeasonPhase.UPCOMING) ?? seasons.findLast((season) => phase(season) === SeasonPhase.ENDED) ?? null;
  }

  /**
   * What everyone sees: the jackpot (live while the season runs, final once settled), how it is split, who holds each place, when the season ends.
   */
  async view() {
    const now = this.#clock.now();
    const season = this.#featured(now);
    if (season === null) {
      return Object.freeze({ season: null });
    }
    const pool = this.#poolOf(season);
    const phase = seasonPhase(this.#settings, season, now);
    const stored = await this.#repository.find(season.id);
    const settled = stored !== null && stored.settledAt !== null;
    const { jackpot, readAt, holders } = settled ? await this.#final(stored) : await this.#live(season, pool, phase);
    const amount = (/** @type {number | null} */ units) => (units === null ? null : this.#formatAmount(units, pool.asset));
    const shares = jackpot === null ? null : pool.split(jackpot);
    return Object.freeze({
      season: Object.freeze({ id: season.id, name: season.name, startsAt: season.startsAt, endsAt: seasonEnd(this.#settings, season), status: statusOf(phase, settled) }),
      bank: this.#bankFor(pool.network),
      asset: pool.asset,
      share: pool.share,
      jackpot: amount(jackpot),
      opening: stored === null ? null : amount(pool.jackpotOf(stored.openingBalance)),
      readAt,
      places: Object.freeze(
        pool.percents.map((percent, index) => {
          const holder = holders.find((candidate) => candidate.place === index + 1) ?? null;
          return Object.freeze({ place: index + 1, percent, amount: amount(shares === null ? null : shares[index].amount), account: holder?.account ?? null, rating: holder?.rating ?? null, paid: holder?.paid ?? null });
        }),
      ),
    });
  }

  /**
   * A settled season: the frozen jackpot and its winners, with their payments.
   * @param {import("../infrastructure/PgJackpotRepository.js").StoredJackpot} stored
   * @returns {Promise<Figures>}
   */
  async #final(stored) {
    const prizes = await this.#repository.prizesOf(stored.season);
    return { jackpot: stored.jackpot, readAt: stored.settledAt, holders: prizes.map(({ place, account, rating, status }) => ({ place, account, rating, paid: status })) };
  }

  /**
   * A season not settled yet: the pool's share of the bank now, and who would win if it ended now.
   * @param {Season} season
   * @param {PrizePool} pool
   * @param {string} phase
   * @returns {Promise<Figures>}
   */
  async #live(season, pool, phase) {
    const reading = await this.#recentBalance(pool);
    const podium = phase === SeasonPhase.UPCOMING ? [] : await this.#ranking.podium(season.id, pool.places);
    return { jackpot: reading === null ? null : pool.jackpotOf(reading.balance), readAt: reading?.readAt ?? null, holders: podium.map(({ rank, account, rating }) => ({ place: rank, account, rating, paid: null })) };
  }

  /** The periodic job: keeps the opening balance of a season that started, settles the seasons that ended. */
  async runOnce() {
    const now = this.#clock.now();
    for (const season of this.#prizeSeasons) {
      const phase = seasonPhase(this.#settings, season, now);
      if (phase === SeasonPhase.RUNNING) {
        await this.#open(season);
      } else if (phase === SeasonPhase.ENDED && now >= /** @type {number} a prize season ends */ (seasonEnd(this.#settings, season)) + this.#poolOf(season).settleAfterMs) {
        await this.settle(season.id);
      }
    }
  }

  /** @param {Season} season */
  async #open(season) {
    if ((await this.#repository.find(season.id)) !== null) {
      return;
    }
    const pool = this.#poolOf(season);
    const reading = await this.#freshBalance(pool);
    if (reading === null) {
      return;
    }
    await this.#repository.open({ season: season.id, network: pool.network, bankAccount: this.#bankFor(pool.network), asset: pool.asset, balance: reading.balance, at: reading.readAt });
    this.#logger.info("season jackpot opened", { season: season.id, bank: reading.balance });
  }

  /**
   * Settles a season that is over, once: freezes the jackpot on the bank's balance now and owes each winner their share.
   * @param {string} seasonId
   * @returns {Promise<boolean>} true when this call settled it
   */
  async settle(seasonId) {
    const season = this.#prizeSeasons.find((candidate) => candidate.id === seasonId);
    if (season === undefined || seasonPhase(this.#settings, season, this.#clock.now()) !== SeasonPhase.ENDED) {
      return false;
    }
    const existing = await this.#repository.find(season.id);
    if (existing !== null && existing.settledAt !== null) {
      return false;
    }
    const pool = this.#poolOf(season);
    const reading = await this.#freshBalance(pool);
    if (reading === null) {
      this.#logger.warn("the bank's wallet cannot be read: the season is settled later", { season: season.id });
      return false;
    }
    const jackpot = pool.jackpotOf(reading.balance);
    const shares = pool.split(jackpot);
    const winners = await this.#ranking.podium(season.id, pool.places);
    const bank = this.#bankFor(pool.network);
    const at = this.#clock.now();
    const settled = await this.#unitOfWork(async () => {
      await this.#repository.open({ season: season.id, network: pool.network, bankAccount: bank, asset: pool.asset, balance: reading.balance, at });
      if (!(await this.#repository.settle({ season: season.id, closingBalance: reading.balance, jackpot, at }))) {
        return false;
      }
      for (const winner of winners) {
        const share = shares[winner.rank - 1];
        if (share.amount === 0) {
          continue;
        }
        await this.#repository.insertPrize({ season: season.id, place: share.place, userId: winner.userId, account: winner.account, network: pool.network, asset: pool.asset, amount: share.amount, percent: share.percent, rating: winner.rating, at });
        await this.#notifications.notify(winner.userId, NotificationKind.SEASON_PRIZE, { season: season.name, place: share.place, amount: this.#formatAmount(share.amount, pool.asset), asset: pool.asset });
      }
      const details = { bank, balance: reading.balance, jackpot, winners: winners.map((winner) => ({ place: winner.rank, account: winner.account, amount: shares[winner.rank - 1].amount })) };
      await this.#audit.record({ actorKind: "system", action: "jackpot.settled", targetKind: "season", targetId: season.id, details });
      return true;
    });
    if (settled) {
      this.#logger.info("season settled", { season: season.id, jackpot, winners: winners.length });
    }
    return settled;
  }

  /**
   * Prizes an operator still has to send or wait for, with what to send.
   * @param {readonly string[]} statuses
   * @param {number} [limit]
   */
  async prizes(statuses, limit = 100) {
    const prizes = await this.#repository.listPrizes(statuses, limit);
    return Object.freeze(prizes.map((prize) => Object.freeze({ ...prize, from: this.#bankFor(prize.network), memo: prizeMemo(prize.season, prize.place), amountText: this.#formatAmount(prize.amount, prize.asset) })));
  }

  /**
   * The bank's balance for the public view: the last reading while it is recent, else a new one (shared by
   * whoever asks meanwhile); the last one known when the chain cannot be read.
   * @param {PrizePool} pool
   * @returns {Promise<BalanceReading | null>}
   */
  async #recentBalance(pool) {
    const key = readingKey(pool, this.#bankFor(pool.network));
    const known = this.#readings.get(key) ?? null;
    if (known !== null && this.#clock.now() - known.readAt < this.#policy.balanceMaxAgeMs) {
      return known;
    }
    let pending = this.#reading.get(key);
    if (pending === undefined) {
      pending = this.#freshBalance(pool).finally(() => this.#reading.delete(key));
      this.#reading.set(key, pending);
    }
    return (await pending) ?? known;
  }

  /**
   * The bank's balance read now; null when the chain cannot tell.
   * @param {PrizePool} pool
   * @returns {Promise<BalanceReading | null>}
   */
  async #freshBalance(pool) {
    const account = this.#bankFor(pool.network);
    const balance = await this.#readBalance(pool.network, account, pool.asset).catch(() => null);
    if (balance === null) {
      return null;
    }
    const reading = Object.freeze({ balance, readAt: this.#clock.now() });
    this.#readings.set(readingKey(pool, account), reading);
    return reading;
  }
}

/**
 * @param {PrizePool} pool
 * @param {string} account
 */
const readingKey = (pool, account) => `${pool.network}:${account}:${pool.asset}`;

/**
 * The memo that pays a season prize.
 * @param {string} season
 * @param {number} place
 */
export const prizeMemo = (season, place) => `m8tcg prize ${season} ${place}`;

/**
 * @param {string} phase
 * @param {boolean} settled
 */
function statusOf(phase, settled) {
  if (settled) {
    return JackpotStatus.SETTLED;
  }
  return phase === SeasonPhase.ENDED ? JackpotStatus.SETTLING : phase;
}
