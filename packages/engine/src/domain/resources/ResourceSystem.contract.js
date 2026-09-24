/**
 * Strategy for how players gain resources. The engine only talks to this
 * contract, so a land-card model can be introduced without touching turn
 * or command logic.
 *
 * @typedef {object} ResourceSystem
 * @property {() => import("./ResourcePool.js").ResourcePool} createPool Pool for a new player.
 * @property {(pool: import("./ResourcePool.js").ResourcePool) => boolean} onTurnStart Applies start-of-turn growth/refill; returns whether the pool changed.
 */

export const RESOURCE_SYSTEM_METHODS = Object.freeze(["createPool", "onTurnStart"]);
