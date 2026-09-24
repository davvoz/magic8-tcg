/**
 * The games being played now, as the server lists them for spectators.
 *
 * @typedef {Readonly<{
 *   gameId: string, mode: string, players: readonly Readonly<{ seat: string, account: string }>[],
 *   turn: number, spectators: number, startedAt: number | null,
 * }>} LiveGame
 *
 * @typedef {object} LiveGamesApi
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Ok<readonly LiveGame[]> | import("@magic8/engine/shared/Result.js").Fail>} live
 */

export {};
