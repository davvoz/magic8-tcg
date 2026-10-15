/**
 * The daily challenges as the game server tells them (docs/tcg/24-sfide.md):
 * today's three opponents, the two tracks, and the player's own day.
 *
 * @typedef {Readonly<{ intro: readonly string[], low: readonly string[], win: readonly string[], lose: readonly string[], unlock: readonly string[] }>} OpponentLines
 *   `win`: the opponent's words when it wins (the player lost), `lose` when it loses, `low` when it is nearly beaten, `unlock` (a boss) when it becomes the next challenge
 * @typedef {Readonly<{ name: string, text: string, scope: string }>} OpponentCondition a rule the opponent brings to the table; `scope`: everyone | opponent | challenger
 * @typedef {Readonly<{
 *   id: string, account: string, name: string, title: string, faction: string, style: string, boss: boolean,
 *   deck: Readonly<{ name: string, size: number }>, lines: OpponentLines, conditions: readonly OpponentCondition[],
 *   state: "beaten" | "next" | "locked",
 * }>} DailyOpponent `account`: the name the opponent's seat has at the table
 * @typedef {Readonly<{ id: string, name: string, reward: string }>} DailyTrack `reward`: the pack won (its drop table's id)
 * @typedef {Readonly<{ gameId: string, stage: number, opponent: string, result: string }>} LastChallenge
 * @typedef {Readonly<{ id: string, definitionId: string, serial: number }>} RewardCard
 * @typedef {Readonly<{
 *   track: string, stage: number, gameId: string | null, attempts: number, rewarded: boolean,
 *   last: LastChallenge | null, reward: Readonly<{ pack: string | null, cards: readonly RewardCard[] }> | null,
 * }>} DailyRun the player's day: `stage` challenges won (3: all), `gameId` the one in play
 * @typedef {Readonly<{ day: string, endsAt: number, tracks: readonly DailyTrack[], opponents: readonly DailyOpponent[], run: DailyRun | null }>} DailyDay
 *
 * @typedef {import("@magic8/engine/shared/Result.js").Fail} Fail
 * @typedef {object} DailyApi
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Ok<DailyDay> | Fail>} today
 * @property {(track: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<DailyDay> | Fail>} chooseTrack
 * @property {(deckId: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<Readonly<{ gameId: string }>> | Fail>} play
 *   starts the next challenge with the account deck (the server's id); the game then arrives like any online game
 */

export const DAILY_API_METHODS = Object.freeze(["today", "chooseTrack", "play"]);
