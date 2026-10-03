/**
 * The games a player has played, as the server lists them: public, by
 * account, newest first, a page at a time.
 *
 * @typedef {"win" | "loss" | "draw"} PlayedResult
 * @typedef {Readonly<{
 *   gameId: string, mode: string, opponent: string, result: PlayedResult, endReason: string | null,
 *   turn: number, startedAt: number | null, finishedAt: number,
 * }>} PlayedGame how one finished game went for the player
 * @typedef {Readonly<{ account: string, games: readonly PlayedGame[], next: string | null }>} GameHistoryPage `next` continues the list, null at its end
 *
 * @typedef {object} GameHistoryApi
 * @property {(account: string, before?: string | null) => Promise<import("@magic8/engine/shared/Result.js").Ok<GameHistoryPage> | import("@magic8/engine/shared/Result.js").Fail>} played
 */

export {};
