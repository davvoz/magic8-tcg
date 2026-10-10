/**
 * Practice games against the AI, as the server counts them: a finished game
 * is sent with its seed, its decks and every move, and the server plays it
 * again before it counts it toward ranked play.
 *
 * @typedef {import("../match/MatchSession.js").MatchTranscript & Readonly<{ you: string }>} PracticeReport `you`: the player's own seat
 * @typedef {Readonly<{ counted: boolean, practiceGames: number }>} PracticeCount `counted` false for a game counted before; `practiceGames` how many the player has now
 *
 * @typedef {object} PracticeApi
 * @property {(report: PracticeReport) => Promise<import("@magic8/engine/shared/Result.js").Ok<PracticeCount> | import("@magic8/engine/shared/Result.js").Fail>} report
 */

export {};
