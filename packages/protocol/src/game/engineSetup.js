/**
 * The one way to build the engine of a recorded game. The authoritative
 * server and the replay verifier must both use it: any difference in setup
 * (player order, names, deck entry order — instance ids are allocated in
 * entry order, so it changes every shuffle) would make an honest game fail
 * verification.
 *
 * Setup rules (docs/tcg/03-game-blockchain-protocol.md §5):
 * - engine player ids are the seats; names are the seat accounts;
 * - the first seat is players[0];
 * - decks are the canonical decks ([cardId, count] sorted by card id);
 * - the seed is the engine key K;
 * - the game's match conditions, if any, are those GAME_CREATED records (`cond`).
 */
import { MatchConditions } from "@magic8/engine/domain/conditions/MatchConditions.js";
import { DeckList } from "@magic8/engine/domain/decks/DeckList.js";
import { fail } from "@magic8/engine/shared/Result.js";
import { GameEngine } from "@magic8/engine/domain/game/GameEngine.js";
import { SEATS } from "./constants.js";
import { canonicalDeck } from "./commitments.js";

/**
 * @typedef {Readonly<{
 *   rules: import("@magic8/engine/domain/game/GameRules.js").GameRules,
 *   catalog: import("@magic8/engine/domain/cards/CardCatalog.js").CardCatalog,
 *   effects: import("@magic8/engine/domain/effects/EffectRegistry.js").EffectRegistry,
 *   createCommands: () => import("@magic8/engine/domain/commands/CommandRegistry.js").CommandRegistry,
 * }>} GameContent
 */

/**
 * @param {{ content: GameContent, accounts: readonly string[], decks: readonly import("./GameRecorder.js").DeckEntries[], firstSeat: string, engineSeed: string, conditions?: unknown }} setup
 *   accounts and decks in seat order; `conditions`: as GAME_CREATED records them (absent: none)
 * @returns {import("@magic8/engine/shared/Result.js").Ok<GameEngine> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function createGameEngine({ content, accounts, decks, firstSeat, engineSeed, conditions = undefined }) {
  const matchConditions = MatchConditions.fromPlain(conditions, SEATS);
  if (!matchConditions.ok) {
    return fail(matchConditions.error.code, `the game's conditions are invalid: ${matchConditions.error.message}`, matchConditions.error.details);
  }
  const order = firstSeat === SEATS[0] ? [0, 1] : [1, 0];
  const players = order.map((index) => ({
    id: SEATS[index],
    name: accounts[index],
    deckList: new DeckList({
      id: `deck_${SEATS[index]}`,
      name: SEATS[index],
      entries: canonicalDeck(decks[index]).map(([cardId, count]) => ({ cardId, count })),
    }),
  }));
  return GameEngine.create({ rules: content.rules, catalog: content.catalog, effects: content.effects, commands: content.createCommands(), players, seed: engineSeed, conditions: matchConditions.value });
}
