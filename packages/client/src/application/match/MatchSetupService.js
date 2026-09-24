/**
 * Use case: start a match. Validates both deck lists against the deck rules
 * (the engine only checks what would break it), builds the engine with the
 * core registries and wraps it in a MatchSession.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { createCoreCommandRegistry } from "@magic8/engine/domain/commands/registerCoreCommands.js";
import { validateDeck } from "@magic8/engine/domain/decks/DeckValidator.js";
import { GameEngine } from "@magic8/engine/domain/game/GameEngine.js";
import { MatchSession } from "./MatchSession.js";

export const MatchSetupError = Object.freeze({
  ILLEGAL_DECK: "ILLEGAL_DECK",
});

/**
 * @typedef {{ id: string, name: string, deckList: import("@magic8/engine/domain/decks/DeckList.js").DeckList, controller: import("./PlayerController.contract.js").PlayerController }} SeatSetup
 */

export class MatchSetupService {
  #content;
  #effects;
  #scheduler;
  #logger;

  /**
   * @param {{ content: import("../content/ContentService.js").GameContent, effects: import("@magic8/engine/domain/effects/EffectRegistry.js").EffectRegistry, scheduler: import("../ports/Scheduler.contract.js").Scheduler, logger: import("../ports/Logger.contract.js").Logger }} deps
   */
  constructor({ content, effects, scheduler, logger }) {
    this.#content = content;
    this.#effects = effects;
    this.#scheduler = scheduler;
    this.#logger = logger;
  }

  /**
   * @param {{ seats: readonly SeatSetup[], seed: string | number, aiDelayMs?: number }} options
   *   `seed`: a 32-byte hex key (see infrastructure/random/seedProvider.js); integers are accepted for tests and tools.
   * @returns {import("@magic8/engine/shared/Result.js").Ok<MatchSession> | import("@magic8/engine/shared/Result.js").Fail}
   */
  createMatch({ seats, seed, aiDelayMs = 0 }) {
    for (const seat of seats) {
      const report = validateDeck(seat.deckList, this.#content.deckRules, this.#content.catalog);
      if (!report.valid) {
        return fail(MatchSetupError.ILLEGAL_DECK, `deck "${seat.deckList.name}" is not legal: ${report.problems[0].message}`, { seatId: seat.id, problems: report.problems });
      }
    }
    const engine = GameEngine.create({
      rules: this.#content.gameRules,
      catalog: this.#content.catalog,
      effects: this.#effects,
      commands: createCoreCommandRegistry(),
      players: seats.map((seat) => ({ id: seat.id, name: seat.name, deckList: seat.deckList })),
      seed,
    });
    if (!engine.ok) {
      return engine;
    }
    const controllers = new Map(seats.map((seat) => [seat.id, seat.controller]));
    return ok(new MatchSession({ engine: engine.value, controllers, scheduler: this.#scheduler, logger: this.#logger, aiDelayMs }));
  }
}
