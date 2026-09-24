import { ResourceModel } from "../game/GameRules.js";
import { ResourcePool } from "./ResourcePool.js";

/**
 * Resource model of the vertical slice: maximum grows by a fixed amount each
 * turn up to a cap, and the pool refills at the start of the owner's turn.
 * @implements {import("./ResourceSystem.contract.js").ResourceSystem}
 */
export class IncrementalResourceSystem {
  #config;

  /** @param {import("../game/GameRules.js").GameRules["resource"]} config */
  constructor(config) {
    this.#config = config;
  }

  createPool() {
    return new ResourcePool({ current: this.#config.startingMax, max: this.#config.startingMax });
  }

  /** @param {ResourcePool} pool */
  onTurnStart(pool) {
    const before = { current: pool.current, max: pool.max };
    pool.grow(this.#config.gainPerTurn, this.#config.max);
    pool.refill();
    return before.current !== pool.current || before.max !== pool.max;
  }
}

/**
 * @param {import("../game/GameRules.js").GameRules} rules
 * @returns {import("./ResourceSystem.contract.js").ResourceSystem}
 */
export function createResourceSystem(rules) {
  if (rules.resource.type === ResourceModel.INCREMENTAL) {
    return new IncrementalResourceSystem(rules.resource);
  }
  throw new Error(`unsupported resource model "${rules.resource.type}"`);
}
