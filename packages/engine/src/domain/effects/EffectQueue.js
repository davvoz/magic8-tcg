/**
 * FIFO of pending effects for the current command. Effects are never
 * resolved recursively: a handler that produces follow-up effects enqueues
 * them and returns. Switching to a LIFO stack (priority/responses) is a
 * change to `dequeue` plus a PASS_PRIORITY command.
 */
const MAX_QUEUED = 1000;

export class EffectQueue {
  /** @type {import("./PendingEffect.js").PendingEffect[]} */
  #items = [];

  /** @param {import("./PendingEffect.js").PendingEffect} effect */
  enqueue(effect) {
    if (this.#items.length >= MAX_QUEUED) {
      throw new RangeError("EffectQueue: too many pending effects");
    }
    this.#items.push(effect);
  }

  /** @returns {import("./PendingEffect.js").PendingEffect | undefined} */
  dequeue() {
    return this.#items.shift();
  }

  get isEmpty() {
    return this.#items.length === 0;
  }

  get size() {
    return this.#items.length;
  }
}
