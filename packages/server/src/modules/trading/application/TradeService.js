/**
 * TradeService: card-for-card trades between players, with escrow
 * (docs/tcg/13-scambi.md).
 *
 * - Offer: the proposer names the counterparty, the copies they give and the
 *   cards they want back. Their copies go into escrow at once (locked: no
 *   deck, no other trade), so an accepted offer can always be honoured.
 * - Accept: the counterparty's copies (chosen by them, or picked for them)
 *   and the escrowed ones swap owners in one unit of work, and the trade is
 *   queued for publication on chain (m8tcg_trade) in that same unit of work.
 * - Decline, cancel, expiry: the escrowed copies go back.
 *
 * Both players hear of every change in their notification feed, written in
 * the unit of work of the change (docs/tcg/15-notifiche.md).
 *
 * Bought copies and the free starter cards can be traded. Trades are card for card: selling cards for
 * STEEM would need an escrow of funds, which this server can never hold
 * (no active keys on the server, docs/tcg/05).
 */
import { MAX_TRADE_CARDS, canonicalize, sha256Hex, tradeRecord, utf8 } from "@magic8/protocol";
import { AppError } from "../../../kernel/AppError.js";
import { isUuid, uuidV4 } from "../../../kernel/random.js";
import { NotificationKind, countCards } from "../../notifications/index.js";
import { TradeStatus, checkProposal, matchesWants } from "../domain/Trade.js";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const ACCOUNT_PATTERN = /^[a-z][a-z0-9.-]{2,15}$/;

export const DEFAULT_TRADE_POLICY = Object.freeze({
  /** How long an offer stays open. */
  ttlMs: 72 * 60 * 60 * 1000,
  /** Open offers one player may have made at a time. */
  maxOpenOffers: 10,
  /** Trades listed per player. */
  listLimit: 50,
  /** Offers expired per run of the job. */
  expiryBatch: 100,
});

/**
 * @typedef {Readonly<{ id: string, definitionId: string, serial: number }>} TradeCard
 */

export class TradeService {
  #repository;
  #inventory;
  #findUser;
  #isKnownCard;
  #outbox;
  #notifier;
  #notifications;
  #audit;
  #clock;
  #random;
  #unitOfWork;
  #logger;
  #network;
  #policy;

  /**
   * @param {{
   *   repository: import("../infrastructure/PgTradeRepository.js").PgTradeRepository,
   *   inventory: import("../../collection/index.js").InventoryService,
   *   findUser: (network: string, account: string) => Promise<{ id: string, account: string } | null>,
   *   isKnownCard: (definitionId: string) => boolean,
   *   outbox: { enqueueTrade: (entry: { network: string, tradeId: string, payload: string }) => Promise<void> },
   *   notifier: { send: (userId: string, type: string, data: unknown) => void },
   *   notifications: { notify: (userId: string, kind: string, data: Record<string, unknown>) => Promise<unknown> },
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   clock: import("../../../kernel/time.js").Clock,
   *   random: import("../../../kernel/random.js").SecureRandom,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   logger: import("../../../kernel/logger.js").Logger,
   *   network: string,
   *   policy?: Partial<typeof DEFAULT_TRADE_POLICY>,
   * }} deps
   */
  constructor({ repository, inventory, findUser, isKnownCard, outbox, notifier, notifications, audit, clock, random, unitOfWork, logger, network, policy = {} }) {
    this.#repository = repository;
    this.#inventory = inventory;
    this.#findUser = findUser;
    this.#isKnownCard = isKnownCard;
    this.#outbox = outbox;
    this.#notifier = notifier;
    this.#notifications = notifications;
    this.#audit = audit;
    this.#clock = clock;
    this.#random = random;
    this.#unitOfWork = unitOfWork;
    this.#logger = logger;
    this.#network = network;
    this.#policy = Object.freeze({ ...DEFAULT_TRADE_POLICY, ...policy });
  }

  /**
   * Offers copies to another player for cards of theirs (none: a gift).
   * @param {{ proposer: { id: string, account: string }, to: unknown, give: unknown, want: unknown, idempotencyKey: string | null, ip: string }} request
   */
  async propose({ proposer, to, give, want, idempotencyKey, ip }) {
    if (idempotencyKey === null || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new AppError("PRECONDITION_REQUIRED", "send an Idempotency-Key header (16 to 64 letters, digits, - or _)");
    }
    const requestHash = sha256Hex(utf8(canonicalize({ to: String(to), give: Array.isArray(give) ? give.map(String) : String(give), want: JSON.stringify(want ?? null) })));
    const previous = await this.#repository.findByIdempotencyKey(proposer.id, idempotencyKey);
    if (previous !== null) {
      return this.#replay(previous, requestHash, proposer.id);
    }
    const proposal = checkProposal({ give, want }, this.#isKnownCard);
    if (!proposal.ok) {
      throw new AppError("VALIDATION", proposal.message);
    }
    const counterparty = await this.#counterpartyFor(proposer.id, to);
    await this.#checkWantsAvailable(counterparty, proposal.wants);
    const now = this.#clock.now();
    /** @type {import("../domain/Trade.js").Trade} */
    const trade = Object.freeze({ id: uuidV4(this.#random), proposerId: proposer.id, counterpartyId: counterparty.id, status: TradeStatus.OPEN, wants: proposal.wants, idempotencyKey, requestHash, createdAt: now, expiresAt: now + this.#policy.ttlMs, closedAt: null });
    const created = await this.#unitOfWork(async () => {
      if (!(await this.#repository.insert(trade))) {
        return false;
      }
      const escrowed = await this.#inventory.escrow({ ownerId: proposer.id, instanceIds: proposal.give, ref: refOf(trade.id) });
      await this.#repository.insertItems(trade.id, "give", proposal.give);
      await this.#notifications.notify(counterparty.id, NotificationKind.TRADE_OFFERED, { tradeId: trade.id, account: proposer.account, give: countCards(escrowed), wants: trade.wants });
      await this.#audit.record({ actorKind: "user", actorUserId: proposer.id, action: "trading.offered", targetKind: "trade", targetId: trade.id, ip, details: { to: counterparty.account, give: proposal.give.length, want: proposal.wants } });
      return true;
    });
    if (!created) {
      return this.#replay(/** @type {import("../domain/Trade.js").Trade} */ (await this.#repository.findByIdempotencyKey(proposer.id, idempotencyKey)), requestHash, proposer.id);
    }
    this.#tell(trade);
    return Object.freeze({ created: true, trade: await this.#view(proposer.id, trade.id) });
  }

  /**
   * Who the offer goes to: another player known here, while the proposer has room for one more open offer.
   * @param {string} proposerId
   * @param {unknown} to
   */
  async #counterpartyFor(proposerId, to) {
    const counterparty = typeof to === "string" && ACCOUNT_PATTERN.test(to) ? await this.#findUser(this.#network, to) : null;
    if (counterparty === null || counterparty.id === proposerId) {
      throw new AppError("VALIDATION", "trade with another player who has played here before");
    }
    if ((await this.#repository.countOpen(proposerId)) >= this.#policy.maxOpenOffers) {
      throw new AppError("LIMIT_REACHED", `at most ${this.#policy.maxOpenOffers} open offers: cancel one first`);
    }
    return counterparty;
  }

  /**
   * The cards another player could give in a trade now, for composing an offer to them.
   * @param {{ userId: string, account: unknown }} request
   * @returns {Promise<readonly Readonly<{ definitionId: string, count: number }>[]>}
   */
  async tradeableOf({ userId, account }) {
    const other = typeof account === "string" && ACCOUNT_PATTERN.test(account) ? await this.#findUser(this.#network, account) : null;
    if (other === null || other.id === userId) {
      throw new AppError("VALIDATION", "trade with another player who has played here before");
    }
    const counts = await this.#inventory.tradeableCounts(other.id);
    return Object.freeze([...counts].filter(([definitionId]) => this.#isKnownCard(definitionId)).map(([definitionId, count]) => Object.freeze({ definitionId, count })));
  }

  /**
   * An offer may only ask for cards the counterparty has (they may still trade them away before answering).
   * @param {{ id: string, account: string }} counterparty
   * @param {readonly { definitionId: string, count: number }[]} wants
   */
  async #checkWantsAvailable(counterparty, wants) {
    if (wants.length === 0) {
      return;
    }
    const counts = await this.#inventory.tradeableCounts(counterparty.id);
    const missing = wants.find((want) => (counts.get(want.definitionId) ?? 0) < want.count);
    if (missing !== undefined) {
      throw new AppError("VALIDATION", `@${counterparty.account} has ${counts.get(missing.definitionId) ?? 0} tradeable ${missing.definitionId}, the offer asks for ${missing.count}`);
    }
  }

  /**
   * The counterparty accepts: their copies (these, or ones picked for them) for the escrowed ones.
   * @param {{ userId: string, tradeId: unknown, copies?: unknown, ip: string }} request
   */
  async accept({ userId, tradeId, copies, ip }) {
    const chosen = copies === undefined ? null : checkCopies(copies);
    const trade = await this.#unitOfWork(async () => {
      const open = await this.#openTrade(tradeId, (candidate) => candidate.counterpartyId === userId);
      const now = this.#clock.now();
      if (now >= open.expiresAt) {
        throw new AppError("CONFLICT", "this offer has expired");
      }
      const taken = chosen === null ? await this.#inventory.pickTradeable({ ownerId: userId, wants: open.wants }) : await this.#inventory.escrow({ ownerId: userId, instanceIds: chosen, ref: refOf(open.id) });
      if (!matchesWants(open.wants, taken)) {
        throw new AppError("VALIDATION", "those copies are not what the offer asks for");
      }
      const given = await this.#repository.itemIds(open.id, "give");
      const ref = refOf(open.id);
      const toCounterparty = await this.#inventory.transfer({ fromId: open.proposerId, toId: userId, instanceIds: given, ref });
      const toProposer = await this.#inventory.transfer({ fromId: userId, toId: open.proposerId, instanceIds: taken.map((copy) => copy.id), ref });
      await this.#repository.insertItems(open.id, "take", taken.map((copy) => copy.id));
      await this.#repository.close(open.id, TradeStatus.ACCEPTED, now);
      const accounts = await this.#publish(open, toCounterparty, toProposer);
      await this.#notifications.notify(open.proposerId, NotificationKind.TRADE_ACCEPTED, { tradeId: open.id, account: accounts.counterparty, received: countCards(toProposer), gave: countCards(toCounterparty) });
      await this.#audit.record({ actorKind: "user", actorUserId: userId, action: "trading.accepted", targetKind: "trade", targetId: open.id, ip, details: { gave: taken.length, received: given.length } });
      return open;
    });
    this.#tell(trade);
    return this.#view(userId, trade.id);
  }

  /**
   * @param {{ userId: string, tradeId: unknown, ip: string }} request
   */
  decline({ userId, tradeId, ip }) {
    return this.#close({ userId, tradeId, ip, status: TradeStatus.DECLINED, may: (trade) => trade.counterpartyId === userId });
  }

  /**
   * @param {{ userId: string, tradeId: unknown, ip: string }} request
   */
  cancel({ userId, tradeId, ip }) {
    return this.#close({ userId, tradeId, ip, status: TradeStatus.CANCELLED, may: (trade) => trade.proposerId === userId });
  }

  /** Closes offers whose time ran out and gives their copies back (periodic job). */
  async expireDue() {
    let expired = 0;
    for (const id of await this.#repository.listExpired(this.#clock.now(), this.#policy.expiryBatch)) {
      const trade = await this.#unitOfWork(async () => {
        const open = await this.#repository.lock(id);
        if (open === null || open.status !== TradeStatus.OPEN || this.#clock.now() < open.expiresAt) {
          return null;
        }
        const returned = await this.#giveBack(open, TradeStatus.EXPIRED);
        const accounts = await this.#repository.accountsOf(open.id);
        const give = countCards(returned);
        await this.#notifications.notify(open.proposerId, NotificationKind.TRADE_EXPIRED, { tradeId: open.id, account: accounts.counterparty, give, wants: open.wants });
        await this.#notifications.notify(open.counterpartyId, NotificationKind.TRADE_EXPIRED, { tradeId: open.id, account: accounts.proposer, give, wants: open.wants });
        await this.#audit.record({ actorKind: "system", action: "trading.expired", targetKind: "trade", targetId: open.id });
        return open;
      });
      if (trade !== null) {
        expired += 1;
        this.#tell(trade);
      }
    }
    return expired;
  }

  /**
   * A player's trades, newest first.
   * @param {string} userId
   */
  async list(userId) {
    const rows = await this.#repository.listFor(userId, this.#policy.listLimit);
    return Object.freeze(rows.map((row) => viewOf(userId, row)));
  }

  /**
   * @param {{ userId: string, tradeId: unknown, ip: string, status: string, may: (trade: import("../domain/Trade.js").Trade) => boolean }} request
   */
  async #close({ userId, tradeId, ip, status, may }) {
    const trade = await this.#unitOfWork(async () => {
      const open = await this.#openTrade(tradeId, may);
      const returned = await this.#giveBack(open, status);
      await this.#tellOtherSide(open, status, countCards(returned));
      await this.#audit.record({ actorKind: "user", actorUserId: userId, action: `trading.${status.toLowerCase()}`, targetKind: "trade", targetId: open.id, ip });
      return open;
    });
    this.#tell(trade);
    return this.#view(userId, trade.id);
  }

  /**
   * @param {import("../domain/Trade.js").Trade} trade
   * @param {string} status
   */
  async #giveBack(trade, status) {
    const returned = await this.#inventory.release({ instanceIds: await this.#repository.itemIds(trade.id, "give"), ref: refOf(trade.id) });
    await this.#repository.close(trade.id, status, this.#clock.now());
    return returned;
  }

  /**
   * A decline reaches the proposer, a cancellation the counterparty.
   * @param {import("../domain/Trade.js").Trade} trade
   * @param {string} status DECLINED or CANCELLED
   * @param {ReturnType<typeof countCards>} give the offered cards
   */
  async #tellOtherSide(trade, status, give) {
    const accounts = await this.#repository.accountsOf(trade.id);
    if (status === TradeStatus.DECLINED) {
      await this.#notifications.notify(trade.proposerId, NotificationKind.TRADE_DECLINED, { tradeId: trade.id, account: accounts.counterparty, give, wants: trade.wants });
    } else {
      await this.#notifications.notify(trade.counterpartyId, NotificationKind.TRADE_CANCELLED, { tradeId: trade.id, account: accounts.proposer, give, wants: trade.wants });
    }
  }

  /**
   * The trade, locked, if it is open and `may` allows this player to act on it.
   * @param {unknown} tradeId
   * @param {(trade: import("../domain/Trade.js").Trade) => boolean} may
   */
  async #openTrade(tradeId, may) {
    const trade = isUuid(tradeId) ? await this.#repository.lock(/** @type {string} */ (tradeId)) : null;
    if (trade === null || !may(trade)) {
      throw new AppError("NOT_FOUND", "no such trade for you");
    }
    if (trade.status !== TradeStatus.OPEN) {
      throw new AppError("CONFLICT", `this trade is already ${trade.status.toLowerCase()}`);
    }
    return trade;
  }

  /**
   * Queues the public record of an accepted trade, in the same unit of work as the swap.
   * @param {import("../domain/Trade.js").Trade} trade
   * @param {readonly import("../../collection/domain/CardInstance.js").CardInstance[]} toCounterparty
   * @param {readonly import("../../collection/domain/CardInstance.js").CardInstance[]} toProposer
   * @returns {Promise<{ proposer: string, counterparty: string }>} the two accounts
   */
  async #publish(trade, toCounterparty, toProposer) {
    const { proposer, counterparty } = await this.#repository.accountsOf(trade.id);
    const cardsOf = (copies) => copies.map((copy) => ({ id: copy.id, definitionId: copy.definitionId, serial: copy.serial }));
    const payload = tradeRecord({ tradeId: trade.id, proposer: { account: proposer, cards: cardsOf(toCounterparty) }, counterparty: { account: counterparty, cards: cardsOf(toProposer) } });
    await this.#outbox.enqueueTrade({ network: this.#network, tradeId: trade.id, payload });
    return { proposer, counterparty };
  }

  /**
   * @param {import("../domain/Trade.js").Trade} trade
   * @param {string} requestHash
   * @param {string} userId
   */
  async #replay(trade, requestHash, userId) {
    if (trade.requestHash !== requestHash) {
      throw new AppError("CONFLICT", "this Idempotency-Key was used for a different offer");
    }
    return Object.freeze({ created: false, trade: await this.#view(userId, trade.id) });
  }

  /**
   * @param {string} userId
   * @param {string} tradeId
   */
  async #view(userId, tradeId) {
    const row = (await this.#repository.listFor(userId, this.#policy.listLimit)).find((candidate) => candidate.trade.id === tradeId);
    if (row === undefined) {
      throw new AppError("NOT_FOUND", "no such trade for you");
    }
    return viewOf(userId, row);
  }

  /** Both players learn that the trade changed (they re-read it). @param {import("../domain/Trade.js").Trade} trade */
  #tell(trade) {
    for (const userId of [trade.proposerId, trade.counterpartyId]) {
      this.#notifier.send(userId, "trade.updated", { tradeId: trade.id });
    }
    this.#logger.info("trade updated", { trade: trade.id });
  }
}

/** @param {string} tradeId */
const refOf = (tradeId) => `trade:${tradeId}`;

/**
 * @param {unknown} copies
 * @returns {readonly string[]}
 */
function checkCopies(copies) {
  const valid = Array.isArray(copies) && copies.length <= MAX_TRADE_CARDS && copies.every((id) => isUuid(id)) && new Set(copies).size === copies.length;
  if (!valid) {
    throw new AppError("VALIDATION", `copies: up to ${MAX_TRADE_CARDS} distinct card ids`);
  }
  return Object.freeze([.../** @type {string[]} */ (copies)]);
}

/**
 * What a player sees of a trade.
 * @param {string} userId
 * @param {Awaited<ReturnType<import("../infrastructure/PgTradeRepository.js").PgTradeRepository["listFor"]>>[number]} row
 */
function viewOf(userId, { trade, proposerAccount, counterpartyAccount, items }) {
  const side = (name) => Object.freeze(items.filter((item) => item.side === name).map((item) => Object.freeze({ id: item.id, definitionId: item.definitionId, serial: item.serial })));
  return Object.freeze({
    id: trade.id,
    status: trade.status,
    role: trade.proposerId === userId ? "proposer" : "counterparty",
    proposer: proposerAccount,
    counterparty: counterpartyAccount,
    give: side("give"),
    wants: trade.wants,
    take: side("take"),
    createdAt: trade.createdAt,
    expiresAt: trade.expiresAt,
    closedAt: trade.closedAt,
  });
}
