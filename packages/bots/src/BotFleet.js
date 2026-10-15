/**
 * The house players together. Each bot stays online on its own (Bot); the
 * fleet adds what one bot cannot see alone: a player searching the queue
 * with nobody to be paired with.
 *
 * Every few seconds one bot reads the lobby's list. A player (not a bot) who
 * has been searching for `waitBeforeHelpMs` gets one free bot sent into the
 * queue: casual first (it costs nothing), then ranked, each for
 * `searchMs` — the lobby does not say which queue a player is in. Paired,
 * the bot plays like any other game; not paired, it leaves the queue. The
 * same player is not helped again for `helpAgainMs`, and one bot searches at
 * a time, so the bots never fill the queue or meet one another there.
 */

export const DEFAULT_FLEET_POLICY = Object.freeze({
  /** How long between the bots coming online (the server limits sign-ins and connections per address). */
  staggerMs: 3000,
  /** How often the lobby's list is read. */
  scanMs: 5000,
  /** How long a player searches alone before a bot steps into the queue. */
  waitBeforeHelpMs: 10_000,
  /** How long a bot waits in a queue to be paired. */
  searchMs: 15_000,
  /** How long before the same player gets help again. */
  helpAgainMs: 2 * 60 * 1000,
});

/** Queues a bot tries, in order: the free one first. */
const MODES = Object.freeze(/** @type {const} */ (["casual", "ranked"]));

/**
 * @typedef {Pick<import("./Bot.js").Bot, "account" | "available" | "start" | "stop" | "onlinePlayers" | "search">} FleetBot
 */

export class BotFleet {
  #bots;
  #accounts;
  #timers;
  #now;
  #random;
  #logger;
  #policy;
  #running = false;
  /** Timers set and not run yet (bots to start, the next read of the lobby). @type {Set<any>} */
  #pending = new Set();
  /** @type {Promise<void> | null} */
  #scanning = null;
  /** Players searching, since when we first saw them so. @type {Map<string, number>} */
  #searchingSince = new Map();
  /** Players helped lately, until when they are not helped again. @type {Map<string, number>} */
  #helped = new Map();
  /** @type {Promise<void> | null} */
  #helping = null;

  /**
   * @param {{
   *   bots: readonly FleetBot[],
   *   timers: { setTimeout: (fn: () => void, ms: number) => any, clearTimeout: (handle: any) => void },
   *   now: () => number,
   *   random: () => number,
   *   logger: import("@magic8/client/src/application/ports/Logger.contract.js").Logger,
   *   policy?: Partial<typeof DEFAULT_FLEET_POLICY>,
   * }} deps
   */
  constructor({ bots, timers, now, random, logger, policy = {} }) {
    this.#bots = bots;
    this.#accounts = new Set(bots.map((bot) => bot.account));
    this.#timers = timers;
    this.#now = now;
    this.#random = random;
    this.#logger = logger;
    this.#policy = Object.freeze({ ...DEFAULT_FLEET_POLICY, ...policy });
  }

  /** Brings the bots online, one after the other, and starts watching the queue. */
  start() {
    if (this.#running) {
      return;
    }
    this.#running = true;
    this.#bots.forEach((bot, index) => this.#later(index * this.#policy.staggerMs, () => bot.start()));
    this.#nextScan();
  }

  async stop() {
    this.#running = false;
    for (const handle of this.#pending) {
      this.#timers.clearTimeout(handle);
    }
    this.#pending.clear();
    await Promise.all(this.#bots.map((bot) => bot.stop()));
    await this.#scanning;
    await this.#helping;
  }

  #nextScan() {
    this.#later(this.#policy.scanMs, () => {
      this.#scanning = this.scan()
        .catch((error) => this.#logger.error("the bots could not read the lobby", { error: error instanceof Error ? error.message : String(error) }))
        .finally(() => {
          this.#scanning = null;
          if (this.#running) {
            this.#nextScan();
          }
        });
    });
  }

  /**
   * @param {number} ms
   * @param {() => void} run
   */
  #later(ms, run) {
    const handle = this.#timers.setTimeout(() => {
      this.#pending.delete(handle);
      if (this.#running) {
        run();
      }
    }, ms);
    this.#pending.add(handle);
  }

  /** Reads who is searching, and sends a bot into the queue for a player who has waited long enough. */
  async scan() {
    const scout = this.#bots.find((bot) => bot.available) ?? this.#bots[0];
    const players = scout === undefined ? null : await scout.onlinePlayers();
    if (players === null) {
      return;
    }
    const now = this.#now();
    const searching = players.filter((player) => player.status === "searching" && !this.#accounts.has(player.account)).map((player) => player.account);
    for (const account of [...this.#searchingSince.keys()].filter((known) => !searching.includes(known))) {
      this.#searchingSince.delete(account);
    }
    for (const account of searching) {
      if (!this.#searchingSince.has(account)) {
        this.#searchingSince.set(account, now);
      }
    }
    for (const [account, until] of this.#helped) {
      if (until <= now) {
        this.#helped.delete(account);
      }
    }
    if (this.#helping !== null) {
      return;
    }
    const waiting = searching.find((account) => now - /** @type {number} */ (this.#searchingSince.get(account)) >= this.#policy.waitBeforeHelpMs && !this.#helped.has(account));
    const free = this.#bots.filter((bot) => bot.available);
    if (waiting === undefined || free.length === 0) {
      return;
    }
    const helper = free[Math.floor(this.#random() * free.length)];
    this.#helped.set(waiting, now + this.#policy.helpAgainMs);
    this.#helping = this.#help(helper, waiting).finally(() => {
      this.#helping = null;
    });
  }

  /** The help in progress, if any (for tests and a clean stop). */
  get helping() {
    return this.#helping;
  }

  /**
   * @param {FleetBot} bot
   * @param {string} account the player waiting alone
   */
  async #help(bot, account) {
    for (const mode of MODES) {
      if (!this.#running || !bot.available) {
        return;
      }
      const { matched, code } = await bot.search(mode, this.#policy.searchMs);
      if (matched) {
        this.#logger.info(`@${bot.account} joined the ${mode} queue for @${account} and was paired`);
        return;
      }
      if (code !== null) {
        this.#logger.info(`@${bot.account} cannot join the ${mode} queue`, { code });
      }
    }
  }
}
