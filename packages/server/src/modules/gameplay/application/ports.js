/**
 * Ports of the gameplay module.
 *
 * @typedef {import("@magic8/protocol").ChainedEvent} ChainedEvent
 * @typedef {Readonly<{ id: string, level: number, style: string, salt: string }>} AiProfile
 *   what plays a seat the server's AI plays: a character (`id`) at a level of the search AI, in a style
 *   (docs/tcg/24-sfide.md); `salt` varies its misjudgements from game to game
 * @typedef {Readonly<{ seat: string, userId: string | null, account: string, deckId: string | null, deck: readonly (readonly [string, number])[], deckCommit: string, entropy: string | null, entropySource: string | null, ai: AiProfile | null }>} StoredPlayer
 *   `userId` null (and `ai` set) for a seat the server's AI plays
 * @typedef {Readonly<{
 *   id: string, mode: string, status: string, network: string, protocolVersion: number, engineVersion: string, contentHash: string,
 *   sealedSecret: Uint8Array, seedCommit: string, firstSeat: string | null, winnerSeat: string | null, endReason: string | null,
 *   version: number, lastEventSeq: number, chainHead: string, createdAt: number, startedAt: number | null, finishedAt: number | null,
 *   players: readonly StoredPlayer[], conditions: readonly Readonly<Record<string, unknown>>[],
 * }>} StoredGame `conditions`: the game's match conditions as GAME_CREATED records them (none: empty)
 * @typedef {Readonly<{ status?: string, version?: number, firstSeat?: string, winnerSeat?: string | null, endReason?: string, startedAt?: number, finishedAt?: number }>} GameChanges
 *
 * @typedef {object} GameRepository
 * @property {(game: StoredGame, created: ChainedEvent) => Promise<void>} insertGame games + game_players + the GAME_CREATED event
 * @property {(gameId: string) => Promise<StoredGame | null>} findGame
 * @property {(gameId: string) => Promise<readonly import("@magic8/protocol").ProtocolEvent[]>} listEvents in sequence order
 * @property {(gameId: string, expectedLastSeq: number, events: readonly ChainedEvent[], changes: GameChanges) => Promise<boolean>} appendEvents
 *   compare-and-set on games.last_event_seq; false (nothing written) when another writer got there first
 * @property {(gameId: string, seat: string, entropy: string, source: string) => Promise<void>} setEntropy
 * @property {(gameId: string, results: Readonly<Record<string, string>>) => Promise<void>} setResults seat → win | loss | draw | aborted
 * @property {(gameId: string, commandId: string) => Promise<Readonly<Record<string, unknown>> | null>} findAck
 * @property {(entry: { gameId: string, commandId: string, seat: string, expectedVersion: number, payload: unknown, accepted: boolean, ack: unknown, at: number }) => Promise<void>} insertCommand
 * @property {(gameId: string, engineVersion: number, commitment: string) => Promise<void>} insertSnapshot
 * @property {() => Promise<readonly string[]>} listActive ids of games not finished or aborted
 * @property {(userId: string) => Promise<string | null>} activeGameOf
 * @property {(query: { mode: string, since: number, limit: number }) => Promise<readonly FinishedGame[]>} listFinished finished games of a mode since a time, oldest first
 * @property {(userId: string, mode: string) => Promise<number>} countFinished games of a mode the user finished (any result)
 * @property {(query: { account: string, before: string | null, limit: number }) => Promise<readonly PlayedGame[]>} listHistory
 *   finished games the account played, newest first, those before the game `before` when given
 *
 * @typedef {object} ResultOutbox where finished games' results wait to be published (the chain module)
 * @property {(entry: { network: string, gameId: string, payload: string }) => Promise<void>} enqueueResult inside the caller's unit of work
 *
 * @typedef {Readonly<{ gameId: string, mode: string, finishedAt: number, winnerSeat: string | null, endReason: string, turn: number,
 *   players: readonly Readonly<{ seat: string, userId: string | null, account: string }>[] }>} FinishedGame what listeners learn when a game ends (`userId` null: the AI's seat)
 * @typedef {Readonly<{ gameId: string, mode: string, opponent: string, result: string, endReason: string | null, turn: number, startedAt: number | null, finishedAt: number }>} PlayedGame
 *   a finished game as one of its players played it: who they faced and how it went for them (win | loss | draw)
 * @typedef {Readonly<{ gameId: string, mode: string, reason: string, players: readonly Readonly<{ seat: string, userId: string | null, account: string }>[] }>} AbortedGame
 *   what listeners learn when a game is called off before it started
 *
 * @typedef {object} GameNotifier delivers messages to a user's live connection, if any
 * @property {(userId: string, type: string, data: unknown) => void} send
 */

/**
 * @typedef {object} MoveSignatures checks the signatures of game protocol v2 (docs/tcg/12)
 * @property {(input: { account: string, message: string, signature: string }) => Promise<boolean>} authorizesSession whether `signature` over `message` is by a posting key of `account` (Keychain)
 * @property {(message: string, signature: string, sessionKey: string) => boolean} verifiesMove whether the session key signed the move
 */

/**
 * @typedef {object} AckSigner signs acks with the server's ack key (never a key that holds funds or publishes)
 * @property {string} publicKey "STM…"
 * @property {(message: string) => string} sign the message's compact signature, as Keychain's signBuffer makes it
 */

/**
 * @typedef {(profile: AiProfile, content: import("@magic8/engine/domain/content/GameContent.js").GameContent) => import("@magic8/engine/domain/ai/AiPolicy.contract.js").AiPolicy} AiFactory
 *   builds the AI that plays a seat, for the content its game was created with
 */

export const GAME_REPOSITORY_METHODS = Object.freeze(["insertGame", "findGame", "listEvents", "appendEvents", "setEntropy", "setResults", "findAck", "insertCommand", "insertSnapshot", "listActive", "activeGameOf", "listFinished", "countFinished", "listHistory"]);

