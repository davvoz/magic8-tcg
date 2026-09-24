/** A player's spendable resource: `current` of `max`, both bounded by the resource system. */
export class ResourcePool {
  /** @type {number} */
  current;
  /** @type {number} */
  max;

  /** @param {{ current: number, max: number }} fields */
  constructor({ current, max }) {
    this.current = current;
    this.max = max;
  }

  /** @param {number} cost */
  canAfford(cost) {
    return cost <= this.current;
  }

  /**
   * @param {number} cost
   * @returns {boolean} false when unaffordable; nothing is spent in that case
   */
  spend(cost) {
    if (!this.canAfford(cost)) {
      return false;
    }
    this.current -= cost;
    return true;
  }

  refill() {
    this.current = this.max;
  }

  /**
   * @param {number} amount
   * @param {number} cap
   */
  grow(amount, cap) {
    this.max = Math.min(cap, this.max + amount);
  }

  clone() {
    return new ResourcePool({ current: this.current, max: this.max });
  }
}
