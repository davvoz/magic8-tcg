/**
 * Builds the engine of a recorded game as the game server built it
 * (docs/tcg/03 §5): the engine key derives from the game's revealed secret,
 * both players' entropy and the game id, and the first player and the decks
 * come from the record. The protocol package owns that derivation.
 */
import { fail } from "@magic8/engine/shared/Result.js";
import { createCoreCommandRegistry } from "@magic8/engine/domain/commands/registerCoreCommands.js";
import { createGameEngine, deriveEngineSeed } from "@magic8/protocol";

/**
 * @param {import("../../application/ports/RecordedGameEngine.contract.js").RecordedGame} game
 * @returns {import("@magic8/engine/shared/Result.js").Ok<import("@magic8/engine/domain/game/GameEngine.js").GameEngine> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function buildRecordedGameEngine({ content, effects, gameId, accounts, decks, firstSeat, secret, entropies }) {
  try {
    return createGameEngine({
      content: { rules: content.gameRules, catalog: content.catalog, effects, createCommands: createCoreCommandRegistry },
      accounts,
      decks,
      firstSeat,
      engineSeed: deriveEngineSeed({ secret, entropies, gameId }),
    });
  } catch (error) {
    return fail("MALFORMED", error instanceof Error ? error.message : String(error));
  }
}
