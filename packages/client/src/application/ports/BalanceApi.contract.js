/**
 * What the signed-in player's wallet holds, as the game server reads it from
 * the chain: liquid amounts, written as the chain writes them ("12.500").
 *
 * @typedef {Readonly<{ asset: string, amount: string }>} Balance
 *
 * @typedef {object} BalanceApi
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Ok<readonly Balance[]> | import("@magic8/engine/shared/Result.js").Fail>} balances
 */

export {};
