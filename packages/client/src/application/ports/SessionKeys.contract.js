/**
 * The keys a browser signs moves with in game protocol v2
 * (docs/tcg/12-mosse-firmate.md): one per game, made so that it cannot be
 * exported, and kept only in memory. A reloaded page makes a new one, which
 * the player authorises again.
 *
 * @typedef {Readonly<{ gameId: string, commandId: string, expectedVersion: number, command: Readonly<Record<string, unknown>> }>} MoveToSign command without playerId
 *
 * @typedef {object} SessionKeys
 * @property {(gameId: string) => Promise<Readonly<{ key: string, authorizationText: string }>>} create a new key for the game (replacing any), and the text its account must sign
 * @property {(gameId: string) => boolean} has
 * @property {(move: MoveToSign) => Promise<string | null>} sign the move's signature, or null without a key for its game
 * @property {(gameId: string) => void} forget
 */

export {};
