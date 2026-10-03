/**
 * The jackpot of the ranked season, as the game server computes it: a share
 * of the bank's wallet (live while the season runs, frozen once it is
 * settled), split among the first places of the leaderboard.
 *
 * @typedef {"upcoming" | "running" | "settling" | "settled"} JackpotStatus `settling`: the season is over, its result not final yet
 * @typedef {Readonly<{ id: string, name: string, startsAt: number, endsAt: number, status: JackpotStatus }>} JackpotSeason
 * @typedef {Readonly<{ place: number, percent: number, amount: string | null, account: string | null, rating: number | null, paid: "PENDING" | "SENT" | "CONFIRMED" | null }>} JackpotPlace
 *   `amount` as the chain writes it ("563.332"), null while the bank cannot be read; `account` who holds the place (who won it, once settled); `paid` once settled
 * @typedef {Readonly<{
 *   season: JackpotSeason, bank: string, asset: string, share: Readonly<{ numerator: number, denominator: number }>,
 *   jackpot: string | null, opening: string | null, readAt: number | null, places: readonly JackpotPlace[],
 * }>} Jackpot `opening`: the jackpot when the season started (null until known); `readAt`: when the bank was read
 *
 * @typedef {object} JackpotApi
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Ok<Jackpot | null> | import("@magic8/engine/shared/Result.js").Fail>} current null when no season has a jackpot
 */

export {};
