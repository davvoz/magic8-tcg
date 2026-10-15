/**
 * Queues the record of copies the game gives away (m8tcg_grant) for the
 * chain, inside the caller's unit of work: the module that mints the copies
 * (the starter claim, the daily challenges' reward) says how to write the
 * record; this names the player by their account and puts it in the outbox.
 */
export class GrantPublisher {
  #outbox;
  #network;
  #accountsOf;

  /**
   * @param {{
   *   outbox: { enqueueGrant: (entry: { network: string, payload: string }) => Promise<void> },
   *   network: string,
   *   accountsOf: (userIds: readonly string[]) => Promise<ReadonlyMap<string, string>>,
   * }} deps
   */
  constructor({ outbox, network, accountsOf }) {
    this.#outbox = outbox;
    this.#network = network;
    this.#accountsOf = accountsOf;
  }

  /**
   * @param {string} userId the player the copies were given to
   * @param {(account: string) => string} record the grant's canonical JSON, for the player's account
   */
  async publish(userId, record) {
    const account = (await this.#accountsOf([userId])).get(userId);
    if (account === undefined) {
      throw new Error(`a grant names user ${userId}, who has no account`);
    }
    await this.#outbox.enqueueGrant({ network: this.#network, payload: record(account) });
  }
}
