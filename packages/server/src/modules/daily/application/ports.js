/**
 * Ports of the daily challenges module.
 *
 * @typedef {Readonly<{
 *   userId: string, day: string, track: string, stage: number, gameId: string | null, attempts: number,
 *   rewardSeed: string | null, rewardCards: readonly RewardCard[] | null, rewardedAt: number | null, createdAt: number,
 * }>} DailyRun a player's day: the track chosen, the challenges won (`stage`, 3: all), the game in play, the pack once won
 * @typedef {Readonly<{ id: string, definitionId: string, serial: number }>} RewardCard a copy of the pack won
 * @typedef {Readonly<{ gameId: string, userId: string, day: string, stage: number, opponent: string, result: string | null, createdAt: number, settledAt: number | null }>} DailyGame
 *   one challenge game; `result` (win | loss | draw | aborted) once it is over
 * @typedef {Readonly<{ stage?: number, gameId?: string | null, attempts?: number, rewardSeed?: string, rewardCards?: readonly RewardCard[], rewardedAt?: number }>} RunChanges
 *
 * @typedef {object} DailyRepository
 * @property {(userId: string, day: string) => Promise<DailyRun | null>} findRun
 * @property {(userId: string, day: string) => Promise<DailyRun | null>} lockRun the same, locked until the unit of work ends
 * @property {(run: DailyRun) => Promise<boolean>} insertRun false when the player already has that day's run
 * @property {(userId: string, day: string, changes: RunChanges) => Promise<void>} updateRun
 * @property {(game: DailyGame) => Promise<void>} insertGame
 * @property {(gameId: string, result: string, at: number) => Promise<DailyGame | null>} settleGame
 *   records how a game went, once: null when it was already settled (or is not a challenge game)
 * @property {(userId: string, day: string) => Promise<readonly DailyGame[]>} listGames the day's games of a player, oldest first
 */

export const DAILY_REPOSITORY_METHODS = Object.freeze(["findRun", "lockRun", "insertRun", "updateRun", "insertGame", "settleGame", "listGames"]);
