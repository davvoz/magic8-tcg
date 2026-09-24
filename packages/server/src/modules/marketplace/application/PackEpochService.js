/**
 * Pack epochs: the secrets that make packs provably fair
 * (docs/tcg/01-architettura.md §7.2, @magic8/protocol packs).
 *
 * - An order with packs is bound to the epoch open when it is created; the
 *   epoch's commitment is public before the order can be paid.
 * - An epoch closes (stops taking orders) after `maxAgeMs`; a new one opens
 *   on the next order.
 * - A closed epoch's secret is revealed only when none of its orders can
 *   still be paid. Revealing earlier would let a buyer grind transaction ids
 *   (a transaction's id changes with its expiration time) until the seed
 *   gives a good pack.
 *
 * Secrets are sealed with SecretBox; only this service opens them. The
 * commitment and the reveal are published on chain (`m8tcg_epoch`, by the
 * broadcaster pool): each goes to the outbox in the same unit of work that
 * opens or reveals the epoch, so neither can happen without the other. The
 * commitment is the most urgent kind of record: it must be on chain before
 * the payments it binds.
 */
import { bytesToHex, packEpochAnnouncement, packEpochCommitment, packEpochReveal } from "@magic8/protocol";

const SECRET_BYTES = 32;

/**
 * @typedef {Readonly<{ id: number, commit: string, openedAt: number, closedAt: number | null, revealedAt: number | null, secret: string | null }>} PublicEpoch
 */

export class PackEpochService {
  #repository;
  #secrets;
  #random;
  #clock;
  #unitOfWork;
  #maxAgeMs;
  #publisher;

  /**
   * @param {{
   *   repository: import("./ports.js").MarketplaceRepository,
   *   secrets: import("../../../kernel/crypto/SecretBox.js").SecretBox,
   *   random: import("../../../kernel/random.js").SecureRandom,
   *   clock: import("../../../kernel/time.js").Clock,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   maxAgeMs: number,
   *   publisher: import("./ports.js").EpochPublisher,
   * }} deps
   */
  constructor({ repository, secrets, random, clock, unitOfWork, maxAgeMs, publisher }) {
    this.#repository = repository;
    this.#secrets = secrets;
    this.#random = random;
    this.#clock = clock;
    this.#unitOfWork = unitOfWork;
    this.#maxAgeMs = maxAgeMs;
    this.#publisher = publisher;
  }

  /**
   * The epoch new orders are bound to, opening one (and closing an expired one) when needed.
   * @returns {Promise<Readonly<{ id: number, commit: string }>>}
   */
  current() {
    return this.#unitOfWork(async () => {
      await this.#repository.lockEpochs();
      const now = this.#clock.now();
      const open = await this.#repository.openEpoch();
      if (open !== null && now - open.openedAt < this.#maxAgeMs) {
        return Object.freeze({ id: open.id, commit: open.commit });
      }
      if (open !== null) {
        await this.#repository.closeEpoch(open.id, now);
      }
      const id = await this.#repository.nextEpochId();
      const secret = this.#random.bytes(SECRET_BYTES);
      const commit = packEpochCommitment(bytesToHex(secret));
      await this.#repository.insertEpoch({ id, commit, sealedSecret: this.#secrets.seal(secret, epochContext(id)), openedAt: now });
      await this.#publisher.publishEpoch(packEpochAnnouncement(id, commit));
      return Object.freeze({ id, commit });
    });
  }

  /**
   * The secret of an epoch, for fulfilment (server side only).
   * @param {number} epochId
   * @returns {Promise<string>} 32 bytes as lowercase hex
   */
  async secretOf(epochId) {
    const epoch = await this.#repository.findEpoch(epochId);
    if (epoch === null) {
      throw new Error(`PackEpochService: no epoch ${epochId}`);
    }
    return bytesToHex(this.#secrets.open(epoch.sealedSecret, epochContext(epochId)));
  }

  /**
   * Reveals closed epochs none of whose orders can still be paid.
   * @returns {Promise<readonly number[]>} ids revealed now
   */
  async revealSettled() {
    const revealed = [];
    for (const epoch of await this.#repository.listUnrevealedClosed(50)) {
      if ((await this.#repository.countOpenForEpoch(epoch.id)) === 0) {
        await this.#unitOfWork(async () => {
          if (await this.#repository.markEpochRevealed(epoch.id, this.#clock.now())) {
            await this.#publisher.publishEpoch(packEpochReveal(epoch.id, bytesToHex(this.#secrets.open(epoch.sealedSecret, epochContext(epoch.id)))));
          }
        });
        revealed.push(epoch.id);
      }
    }
    return Object.freeze(revealed);
  }

  /** @returns {Promise<readonly PublicEpoch[]>} newest first; secrets only once revealed */
  async publicEpochs() {
    const epochs = await this.#repository.listEpochs();
    return Object.freeze(
      epochs.map((epoch) =>
        Object.freeze({
          id: epoch.id,
          commit: epoch.commit,
          openedAt: epoch.openedAt,
          closedAt: epoch.closedAt,
          revealedAt: epoch.revealedAt,
          secret: epoch.revealedAt === null ? null : bytesToHex(this.#secrets.open(epoch.sealedSecret, epochContext(epoch.id))),
        }),
      ),
    );
  }
}

/** @param {number} id */
const epochContext = (id) => `rng_epoch:${id}`;
