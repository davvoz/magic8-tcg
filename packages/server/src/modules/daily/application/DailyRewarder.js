/**
 * Gives a player the pack they won with the day's three challenges, inside
 * the unit of work that records the last win: the pack is drawn from the
 * track's drop table (the shop's, so the odds are the shop's), the cards are
 * minted to the player as rewards (theirs to keep, trade and sell), and the
 * notification is written with them.
 *
 * The pack's seed is a fresh random 32 bytes, kept with the run and
 * published with the copies (m8tcg_grant, with the drop table's hash):
 * anyone draws the same cards again with @magic8/protocol drawPack, so what
 * a player received can always be checked, and every reward copy that is
 * later traded or sold has its public birth.
 */
import { GrantKind, bytesToHex, drawPack, grantRecord } from "@magic8/protocol";

const SEED_BYTES = 32;
/** The origin of reward copies (collection's OriginKind.REWARD). */
const REWARD_ORIGIN = "reward";

export class DailyRewarder {
  #dropTable;
  #inventory;
  #notifications;
  #notificationKind;
  #countCards;
  #random;
  #grants;

  /**
   * @param {{
   *   dropTable: (id: string) => { table: import("@magic8/protocol").DropTable, hash: string } | undefined,
   *   inventory: import("../../collection/index.js").InventoryService,
   *   notifications: { notify: (userId: string, kind: string, data: Record<string, unknown>) => Promise<unknown> },
   *   notificationKind: string,
   *   countCards: (copies: readonly { definitionId: string }[]) => readonly unknown[],
   *   random: import("../../../kernel/random.js").SecureRandom,
   *   grants: { publish: (userId: string, record: (account: string) => string) => Promise<void> },
   * }} deps `grants`: queues a grant record for the chain, given how to write it for the player's account
   */
  constructor({ dropTable, inventory, notifications, notificationKind, countCards, random, grants }) {
    this.#dropTable = dropTable;
    this.#inventory = inventory;
    this.#notifications = notifications;
    this.#notificationKind = notificationKind;
    this.#countCards = countCards;
    this.#random = random;
    this.#grants = grants;
  }

  /**
   * @param {{ userId: string, day: string, track: import("../domain/DailyTracks.js").Track }} winner
   * @returns {Promise<Readonly<{ seed: string, cards: readonly import("../../collection/domain/CardInstance.js").CardInstance[] }>>}
   */
  async reward({ userId, day, track }) {
    const resolved = this.#dropTable(track.reward);
    if (resolved === undefined) {
      throw new Error(`the ${track.id} track's reward "${track.reward}" is not a drop table`);
    }
    const seed = bytesToHex(this.#random.bytes(SEED_BYTES));
    const drawn = drawPack(resolved.table, seed);
    const counts = new Map();
    for (const card of drawn) {
      counts.set(card.cardId, (counts.get(card.cardId) ?? 0) + 1);
    }
    const cards = await this.#inventory.mint({
      ownerId: userId,
      items: [...counts].map(([definitionId, count]) => ({ definitionId, count })),
      edition: resolved.table.edition,
      origin: { kind: REWARD_ORIGIN, ref: `daily:${day}` },
    });
    const copies = cards.map((copy) => ({ id: copy.id, definitionId: copy.definitionId, serial: copy.serial }));
    await this.#grants.publish(userId, (account) => grantRecord({ kind: GrantKind.DAILY, account, cards: copies, day, track: track.id, tableHash: resolved.hash, seed }));
    await this.#notifications.notify(userId, this.#notificationKind, { day, track: track.id, pack: track.reward, cards: this.#countCards(cards) });
    return Object.freeze({ seed, cards });
  }
}
