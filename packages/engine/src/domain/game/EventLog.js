/**
 * Bounded, append-only list of events produced during one command execution.
 * Exceeding the bound is treated as a runaway resolution: the engine aborts
 * the command and discards the working state.
 */
export class EventLogOverflowError extends Error {
  constructor(limit) {
    super(`event log exceeded ${limit} events in a single command`);
    this.name = "EventLogOverflowError";
  }
}

export class EventLog {
  /** @type {Readonly<Record<string, unknown>>[]} */
  #events = [];
  #limit;

  /** @param {number} limit */
  constructor(limit) {
    this.#limit = limit;
  }

  /**
   * @param {string} type
   * @param {Record<string, unknown>} [data]
   */
  emit(type, data = {}) {
    if (this.#events.length >= this.#limit) {
      throw new EventLogOverflowError(this.#limit);
    }
    this.#events.push(Object.freeze({ type, ...data }));
  }

  get count() {
    return this.#events.length;
  }

  /** @returns {readonly Readonly<Record<string, unknown>>[]} */
  toArray() {
    return Object.freeze([...this.#events]);
  }
}
