/**
 * Builds the engine of a recorded game, dealt exactly as the game server
 * dealt it, from what the game's record reveals.
 *
 * @typedef {Readonly<{
 *   content: import("../content/ContentService.js").GameContent,
 *   effects: import("@magic8/engine/domain/effects/EffectRegistry.js").EffectRegistry,
 *   gameId: string, accounts: readonly string[], decks: readonly (readonly [string, number])[][], firstSeat: string, secret: string, entropies: readonly string[],
 * }>} RecordedGame `accounts`, `decks`, `entropies` in seat order
 *
 * @typedef {(game: RecordedGame) => import("@magic8/engine/shared/Result.js").Ok<import("@magic8/engine/domain/game/GameEngine.js").GameEngine> | import("@magic8/engine/shared/Result.js").Fail} BuildRecordedGameEngine
 */

export {};
