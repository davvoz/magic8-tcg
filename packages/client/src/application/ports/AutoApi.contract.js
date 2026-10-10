/**
 * Played auto games (docs/tcg/23-automatica.md), public: everything needed
 * to replay one and check it.
 *
 * @typedef {Readonly<{ i: number, k: string, a: string | null, t: number, ms: number, d: any }>} ProtocolEvent
 * @typedef {Readonly<{ seat: string, account: string, style: string, commit: string, secret: string, entropy: string }>} AutoTicketReveal
 * @typedef {Readonly<{
 *   gameId: string, mode: string, contentHash: string, winnerSeat: string | null, endReason: string | null, finishedAt: number | null,
 *   players: readonly Readonly<{ seat: string, account: string }>[], aiVersion: number | null,
 *   tickets: readonly AutoTicketReveal[], events: readonly ProtocolEvent[],
 * }>} AutoGameReplay
 *
 * @typedef {object} AutoApi
 * @property {(gameId: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<AutoGameReplay> | import("@magic8/engine/shared/Result.js").Fail>} replay
 */

export {};
