/**
 * PrizePayoutWatcher: closes season prizes from what the chain shows, never
 * from what an operator says (like refunds, docs/tcg/07-runbook.md).
 *
 * The operator pays a prize with Keychain from the bank, with the memo
 * `m8tcg prize <season> <place>`. The watcher reads the bank's outgoing
 * transfers from its own cursor: a transfer with that memo, to the winner,
 * of exactly the prize's asset and amount marks it SENT; it becomes
 * CONFIRMED once independent nodes place it below the irreversible block,
 * or goes back to PENDING if it vanished. A transfer that does not match,
 * or pays a prize twice, is audited and logged as an error: a human must
 * look at it.
 */
import { prizeMemo } from "./JackpotService.js";

const PRIZE_MEMO = /^m8tcg prize ([a-z0-9-]{1,32}) ([1-9]\d?)$/;
/** api.steemit.com and most nodes refuse more than 100 history entries per call. */
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const CONFIRM_BATCH = 50;

export class PrizePayoutWatcher {
  #repository;
  #cursors;
  #providers;
  #bankFor;
  #networks;
  #audit;
  #clock;
  #logger;
  /** Transfers already flagged by this process: each read re-covers a few entries before the cursor. */
  #flagged = new Set();

  /**
   * @param {{
   *   repository: import("../infrastructure/PgJackpotRepository.js").PgJackpotRepository,
   *   cursors: Pick<import("../../payments/application/ports.js").PaymentRepository, "getCursor" | "setCursor">,
   *   providers: ReadonlyMap<string, import("../../payments/application/ports.js").PaymentProvider>,
   *   bankFor: (network: string) => string,
   *   networks: readonly string[],
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   clock: import("../../../kernel/time.js").Clock,
   *   logger: import("../../../kernel/logger.js").Logger,
   * }} deps `networks`: those of the prize pools
   */
  constructor({ repository, cursors, providers, bankFor, networks, audit, clock, logger }) {
    this.#repository = repository;
    this.#cursors = cursors;
    this.#providers = providers;
    this.#bankFor = bankFor;
    this.#networks = networks;
    this.#audit = audit;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * One round: on a network with prizes waiting, detect their transfers and confirm the sent ones; on the
   * others, only start the cursor (from then on, every transfer of the bank will be read once prizes are owed).
   */
  async runOnce() {
    const open = await this.#repository.listPrizes(["PENDING", "SENT"], CONFIRM_BATCH);
    for (const network of this.#networks.filter((candidate) => this.#providers.has(candidate))) {
      if (open.some((prize) => prize.network === network)) {
        await this.poll(network);
        await this.confirm(network);
      } else {
        await this.#startCursor(network);
      }
    }
  }

  /**
   * @param {string} network
   * @returns {Promise<string>} the cursor's name
   */
  async #startCursor(network) {
    const bank = this.#bankFor(network);
    const cursorName = `prizes:${network}:${bank}`;
    if ((await this.#cursors.getCursor(cursorName)) === null) {
      const provider = /** @type {import("../../payments/application/ports.js").PaymentProvider} */ (this.#providers.get(network));
      await this.#cursors.setCursor(cursorName, network, await provider.latestPosition(bank), this.#clock.now());
    }
    return cursorName;
  }

  /**
   * @param {string} network
   * @returns {Promise<number>} prizes marked SENT
   */
  async poll(network) {
    const provider = /** @type {import("../../payments/application/ports.js").PaymentProvider} */ (this.#providers.get(network));
    const bank = this.#bankFor(network);
    const cursorName = await this.#startCursor(network);
    let position = /** @type {import("../../payments/application/ports.js").HistoryPosition} */ (await this.#cursors.getCursor(cursorName));
    let sent = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const batch = await provider.outgoingTransfers(bank, position.cursor, PAGE_SIZE, position.sinceBlock);
      for (const transfer of batch.transfers) {
        sent += (await this.#observe(transfer)) ? 1 : 0;
      }
      if (batch.cursor === position.cursor && batch.sinceBlock === position.sinceBlock) {
        break;
      }
      position = { cursor: batch.cursor, sinceBlock: batch.sinceBlock };
      await this.#cursors.setCursor(cursorName, network, position, this.#clock.now());
    }
    return sent;
  }

  /**
   * @param {import("../../payments/application/ports.js").Transfer} transfer
   * @returns {Promise<boolean>} true when it paid a pending prize
   */
  async #observe(transfer) {
    const match = PRIZE_MEMO.exec(transfer.memo);
    if (match === null) {
      return false;
    }
    const [, season, placeText] = match;
    const place = Number(placeText);
    const target = `${season}:${place}`;
    const found = await this.#repository.findPrize(season, place);
    const prize = found !== null && found.network === transfer.network ? found : null;
    const where = { txId: transfer.txId, to: transfer.to, asset: transfer.asset, amount: transfer.amount };
    if (prize === null) {
      await this.#flag("jackpot.prize_unknown", target, where);
      return false;
    }
    if (prize.transfer !== null && prize.transfer.txId !== transfer.txId) {
      await this.#flag("jackpot.prize_paid_twice", target, { ...where, first: prize.transfer.txId });
      return false;
    }
    if (transfer.to !== prize.account || transfer.asset !== prize.asset || transfer.amount !== prize.amount) {
      await this.#flag("jackpot.prize_mismatch", target, { ...where, expected: { to: prize.account, asset: prize.asset, amount: prize.amount } });
      return false;
    }
    const marked = await this.#repository.markSent(season, place, transfer);
    if (marked) {
      await this.#audit.record({ actorKind: "system", action: "jackpot.prize_sent", targetKind: "season_prize", targetId: target, details: where });
    }
    return marked;
  }

  /**
   * @param {string} network
   * @returns {Promise<number>} prizes confirmed
   */
  async confirm(network) {
    const provider = /** @type {import("../../payments/application/ports.js").PaymentProvider} */ (this.#providers.get(network));
    const bank = this.#bankFor(network);
    let confirmed = 0;
    const sent = (await this.#repository.listPrizes(["SENT"], CONFIRM_BATCH)).filter((prize) => prize.network === network);
    for (const prize of sent) {
      const transfer = /** @type {NonNullable<typeof prize.transfer>} */ (prize.transfer);
      const target = `${prize.season}:${prize.place}`;
      const verdict = await provider.confirm({ network, ...transfer, from: bank, to: prize.account, asset: prize.asset, amount: prize.amount, memo: prizeMemo(prize.season, prize.place) });
      if (verdict === "IRREVERSIBLE" && (await this.#repository.confirm(prize.season, prize.place, this.#clock.now()))) {
        await this.#audit.record({ actorKind: "system", action: "jackpot.prize_confirmed", targetKind: "season_prize", targetId: target, details: { txId: transfer.txId } });
        confirmed += 1;
      } else if (verdict === "MISSING" && (await this.#repository.reopen(prize.season, prize.place))) {
        this.#logger.warn("a prize transfer vanished from the chain; the prize is pending again", { prize: target, txId: transfer.txId });
      }
    }
    return confirmed;
  }

  /**
   * @param {string} action
   * @param {string} target
   * @param {Readonly<Record<string, unknown>>} details
   */
  async #flag(action, target, details) {
    const key = `${action}:${target}:${String(details.txId)}`;
    if (this.#flagged.has(key)) {
      return;
    }
    this.#flagged.add(key);
    this.#logger.error(`prize transfer needs attention: ${action}`, { prize: target, ...details });
    await this.#audit.record({ actorKind: "system", action, targetKind: "season_prize", targetId: target, details });
  }
}
