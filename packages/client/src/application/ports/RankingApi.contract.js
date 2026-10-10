/**
 * Ranked play as the client sees it: a player's standing and the season's
 * leaderboard, both computed by the server.
 *
 * @typedef {Readonly<{ id: string, name: string }>} Season
 * @typedef {Readonly<{
 *   season: Season | null, rating: number, deviation: number, provisional: boolean, rank: number | null,
 *   games: number, wins: number, losses: number, draws: number, eligible: boolean, casualGamesNeeded: number, practiceGamesNeeded: number,
 * }>} Standing not `eligible` yet: ranked opens after `casualGamesNeeded` more casual games, or `practiceGamesNeeded` more practice games against the AI
 * @typedef {Readonly<{ rank: number | null, provisional: boolean, account: string, rating: number, games: number, wins: number, losses: number, draws: number }>} LeaderboardEntry
 * @typedef {Readonly<{ season: Season | null, entries: readonly LeaderboardEntry[] }>} Leaderboard
 *
 * @typedef {object} RankingApi
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Ok<Standing> | import("@magic8/engine/shared/Result.js").Fail>} standing
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Ok<Leaderboard> | import("@magic8/engine/shared/Result.js").Fail>} leaderboard
 */

export {};
