/**
 * Use case: start a match. Validates both deck lists against the deck rules
 * (the engine only checks what would break it), builds the engine with the
 * core registries and wraps it in a MatchSession.
 *
 * Who plays first: the first seat, unless a `coinSeed` is given — then a
 * coin is tossed (CoinToss) and its winner takes the first turn. The toss
 * draws from its own seed so it never shares randomness with the shuffles.
 *
 * A scripted match (the tutorial) may deal its decks unshuffled, in their
 * lists' order, and play by rules of its own (a shorter game).
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { createCoreCommandRegistry } from "@magic8/engine/domain/commands/registerCoreCommands.js";
import { validateDeck } from "@magic8/engine/domain/decks/DeckValidator.js";
import { GameEngine } from "@magic8/engine/domain/game/GameEngine.js";
import { ChaChaRandom } from "@magic8/engine/domain/random/ChaChaRandom.js";
import { CoinToss } from "./CoinToss.js";
import { MatchSession } from "./MatchSession.js";

export const MatchSetupError = Object.freeze({
  ILLEGAL_DECK: "ILLEGAL_DECK",
  INVALID_SEED: "INVALID_SEED",
});

/**
 * @typedef {{ id: string, name: string, deckList: import("@magic8/engine/domain/decks/DeckList.js").DeckList, controller: import("./PlayerController.contract.js").PlayerController, account?: string | null }} SeatSetup
 *   `account`: the STEEM account playing the seat (the signed-in player), whose profile picture the board shows
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
   * @param {{ seats: readonly SeatSetup[], seed: string | number, coinSeed?: string | number, aiDelayMs?: number, shuffle?: boolean, rules?: import("@magic8/engine/domain/game/GameRules.js").GameRules }} options
   *   `seed`: a 32-byte hex key (see infrastructure/random/seedProvider.js); integers are accepted for tests and tools.
   *   `coinSeed`: same form; when given, a coin toss decides who plays first and the session shows it before the first turn.
   *   `shuffle`: false deals every deck in its list's order, top first; `rules`: the match's rules, when not the game's
   * @returns {import("@magic8/engine/shared/Result.js").Ok<MatchSession> | import("@magic8/engine/shared/Result.js").Fail}
   */
  createMatch({ seats, seed, coinSeed, aiDelayMs = 0, shuffle = true, rules = this.#content.gameRules }) {
    for (const seat of seats) {
      const report = validateDeck(seat.deckList, this.#content.deckRules, this.#content.catalog);
      if (!report.valid) {
        return fail(MatchSetupError.ILLEGAL_DECK, `deck "${seat.deckList.name}" is not legal: ${report.problems[0].message}`, { seatId: seat.id, problems: report.problems });
      }
    }
    if (coinSeed !== undefined && !ChaChaRandom.isValidSeed(coinSeed)) {
      return fail(MatchSetupError.INVALID_SEED, "the coin seed must be a 32-byte key (hex or bytes) or a safe integer");
    }
    const openingToss = coinSeed === undefined ? null : tossBetween(seats, coinSeed);
    const seated = firstPlayerAhead(seats, openingToss);
    const engine = GameEngine.create({
      rules,
      catalog: this.#content.catalog,
      effects: this.#effects,
      commands: createCoreCommandRegistry(),
      players: seated.map((seat) => ({ id: seat.id, name: seat.name, deckList: seat.deckList })),
      seed,
      shuffle,
    });
    if (!engine.ok) {
      return engine;
    }
    const controllers = new Map(seats.map((seat) => [seat.id, seat.controller]));
    const accounts = new Map(seats.flatMap((seat) => (typeof seat.account === "string" ? [[seat.id, seat.account]] : [])));
    const setup = this.#dealingFor({ seed, seated, shuffle, rules });
    return ok(new MatchSession({ engine: engine.value, controllers, scheduler: this.#scheduler, logger: this.#logger, aiDelayMs, openingToss, accounts, setup }));
  }

  /**
   * What the engine was dealt from, for a game that can be played again elsewhere (the server counts practice
   * games): one by the game's own rules, shuffled from a real seed. Null for any other.
   * @param {{ seed: string | number, seated: readonly SeatSetup[], shuffle: boolean, rules: import("@magic8/engine/domain/game/GameRules.js").GameRules }} match `seated` in engine order
   * @returns {import("./MatchSession.js").MatchDealing | null}
   */
  #dealingFor({ seed, seated, shuffle, rules }) {
    if (!shuffle || rules !== this.#content.gameRules || typeof seed !== "string") {
      return null;
    }
    return Object.freeze({ seed, players: Object.freeze(seated.map((seat) => Object.freeze({ id: seat.id, deck: seat.deckList.entries }))) });
  }
}

/**
 * The toss between the two seats; none when the seats are not two distinct
 * players, which the engine then refuses with its own reason.
 * @param {readonly SeatSetup[]} seats
 * @param {string | number} coinSeed
 */
function tossBetween(seats, coinSeed) {
  const playerIds = seats.map((seat) => seat.id);
  if (playerIds.length !== 2 || playerIds[0] === playerIds[1]) {
    return null;
  }
  return CoinToss.flip({ playerIds, random: ChaChaRandom.fromSeed(coinSeed) });
}

/**
 * The seats in engine order: the engine gives the first turn to the first
 * player, so the toss winner moves to the front.
 * @param {readonly SeatSetup[]} seats
 * @param {CoinToss | null} toss
 */
function firstPlayerAhead(seats, toss) {
  if (toss === null) {
    return seats;
  }
  return [...seats].sort((a, b) => Number(b.id === toss.firstPlayerId) - Number(a.id === toss.firstPlayerId));
}
