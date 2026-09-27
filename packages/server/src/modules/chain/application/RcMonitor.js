/**
 * RcMonitor: watches the broadcasters' Resource Credits (docs/tcg/03 §10).
 *
 * Below the slow threshold the log warns that a broadcaster is running low;
 * below the critical threshold it stops and an alert asks a human to add
 * Steem Power (ideally delegated from a cold account). Nothing else stops:
 * the database stays the operational source and the outbox waits.
 */
export const ResourceMode = Object.freeze({ NORMAL: "NORMAL", SLOW: "SLOW", PAUSED: "PAUSED" });

export const DEFAULT_RC_POLICY = Object.freeze({
  slowBelowBasisPoints: 2000,
  pauseBelowBasisPoints: 500,
});

const DAY_MS = 24 * 60 * 60 * 1000;

export class RcMonitor {
  #transactions;
  #reader;
  #repository;
  #clock;
  #logger;
  #policy;
  /** @type {Map<string, Readonly<{ basisPoints: number, mode: string }>>} */
  #levels = new Map();

  /**
   * @param {{
   *   transactions: import("./ports.js").TransactionProvider,
   *   reader: import("./ports.js").PublicationReader,
   *   repository: import("../infrastructure/PgChainRepository.js").PgChainRepository,
   *   clock: import("../../../kernel/time.js").Clock,
   *   logger: import("../../../kernel/logger.js").Logger,
   *   policy?: Partial<typeof DEFAULT_RC_POLICY>,
   * }} deps
   */
  constructor({ transactions, reader, repository, clock, logger, policy = {} }) {
    this.#transactions = transactions;
    this.#reader = reader;
    this.#repository = repository;
    this.#clock = clock;
    this.#logger = logger;
    this.#policy = Object.freeze({ ...DEFAULT_RC_POLICY, ...policy });
  }

  /**
   * Until a level has been read, a broadcaster works normally.
   * @param {string} signer
   */
  modeOf(signer) {
    return this.#levels.get(signer)?.mode ?? ResourceMode.NORMAL;
  }

  /** @returns {Readonly<Record<string, Readonly<{ basisPoints: number, mode: string }>>>} */
  levels() {
    return Object.freeze(Object.fromEntries(this.#levels));
  }

  /** Reads every broadcaster's level; a read that fails keeps the last known one. */
  async runOnce() {
    const head = await this.#reader.head();
    for (const signer of this.#transactions.signers) {
      try {
        const { basisPoints } = await this.#transactions.resourceLevel(signer, head.time);
        await this.#update(signer, basisPoints);
      } catch (error) {
        this.#logger.warn("resource credits could not be read", { signer, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  /**
   * @param {string} signer
   * @param {number} basisPoints
   */
  async #update(signer, basisPoints) {
    const mode = this.#modeFor(basisPoints);
    const previous = this.modeOf(signer);
    this.#levels.set(signer, Object.freeze({ basisPoints, mode }));
    if (mode === previous) {
      return;
    }
    const fields = { signer, percent: basisPoints / 100 };
    if (mode === ResourceMode.PAUSED) {
      this.#logger.error("broadcaster out of resource credits: paused", fields);
      const day = new Date(Math.floor(this.#clock.now() / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
      await this.#repository.insertAlert({ network: this.#transactions.network, kind: "RC_CRITICAL", fingerprint: `${signer}:${day}`, details: fields, at: this.#clock.now() });
    } else if (mode === ResourceMode.SLOW) {
      this.#logger.warn("broadcaster low on resource credits", fields);
    } else {
      this.#logger.info("broadcaster resource credits recovered", fields);
    }
  }

  /** @param {number} basisPoints */
  #modeFor(basisPoints) {
    if (basisPoints < this.#policy.pauseBelowBasisPoints) {
      return ResourceMode.PAUSED;
    }
    return basisPoints < this.#policy.slowBelowBasisPoints ? ResourceMode.SLOW : ResourceMode.NORMAL;
  }
}
