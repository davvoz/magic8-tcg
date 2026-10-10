/**
 * PracticeService: practice games against the AI, which open ranked play
 * like casual games do (docs/tcg/09-classificata.md).
 *
 * A practice game is played in the browser, where the server takes no part,
 * so the signed-in player sends it once it is over: its seed, the two decks
 * in seating order (first player first) and every move both seats made. The
 * server plays it again on its own engine from that seed, move by move, and
 * counts it only if every move is legal and the game ends with the last one.
 * A game the player conceded does not count. The seed is the game: the same
 * one counts once, for one player.
 *
 * Nothing proves the other seat was the AI; what it does prove is that a
 * whole legal game was played to its end, which is what opening ranked play
 * asks of a new account.
 */
import { createCoreCommandRegistry } from "@magic8/engine/domain/commands/registerCoreCommands.js";
import { DeckList } from "@magic8/engine/domain/decks/DeckList.js";
import { validateDeck } from "@magic8/engine/domain/decks/DeckValidator.js";
import { GameEndReason } from "@magic8/engine/domain/game/GameEventType.js";
import { GameEngine } from "@magic8/engine/domain/game/GameEngine.js";
import { sha256Hex, utf8 } from "@magic8/protocol";
import { AppError } from "../../../kernel/AppError.js";

/** Moves a practice game may take: real games take a few hundred. */
export const MAX_PRACTICE_MOVES = 5000;
const SEED = /^[0-9a-f]{64}$/;
const SEAT_ID = /^[a-z0-9_-]{1,32}$/;
const CARD_ID = /^[a-z0-9_-]{1,64}$/;
const MAX_DECK_ENTRIES = 100;
const MAX_COPIES = 60;

/**
 * @typedef {Readonly<{ id: string, deck: readonly Readonly<{ cardId: string, count: number }>[] }>} PracticeSeat
 * @typedef {Readonly<{ seed: string, you: string, players: readonly PracticeSeat[], moves: readonly Readonly<Record<string, unknown>>[] }>} PracticeReport
 *   `players` in seating order, the first player first; `you`: the id of the player's own seat
 */

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export class PracticeService {
  #repository;
  #currentContent;
  #effects;
  #clock;
  #logger;

  /**
   * @param {{
   *   repository: import("../infrastructure/PgPracticeRepository.js").PgPracticeRepository,
   *   currentContent: () => import("@magic8/engine/domain/content/GameContent.js").GameContent,
   *   effects: import("@magic8/engine/domain/effects/EffectRegistry.js").EffectRegistry,
   *   clock: import("../../../kernel/time.js").Clock,
   *   logger: import("../../../kernel/logger.js").Logger,
   * }} deps
   */
  constructor({ repository, currentContent, effects, clock, logger }) {
    this.#repository = repository;
    this.#currentContent = currentContent;
    this.#effects = effects;
    this.#clock = clock;
    this.#logger = logger;
  }

  /**
   * Plays a reported game again and counts it for the player when it holds.
   * @param {string} userId
   * @param {unknown} body the report, untrusted
   * @returns {Promise<Readonly<{ counted: boolean, practiceGames: number }>>} `counted` false for a game already counted
   */
  async report(userId, body) {
    const report = parseReport(body);
    const content = this.#currentContent();
    const decks = report.players.map((seat) => deckOf(seat, content));
    const end = this.#replay(report, decks, content);
    const result = resultOf(end.winnerId, report.you);
    if (end.endReason === GameEndReason.CONCEDE && result === "loss") {
      throw new AppError("VALIDATION", "a game you conceded does not count");
    }
    const counted = await this.#repository.insert({ seedHash: sha256Hex(utf8(report.seed)), userId, result, endReason: end.endReason, turns: end.turnNumber, moves: report.moves.length, at: this.#clock.now() });
    if (counted) {
      this.#logger.info("practice game counted", { userId, result, turns: end.turnNumber, moves: report.moves.length });
    }
    return Object.freeze({ counted, practiceGames: await this.#repository.countOf(userId) });
  }

  /**
   * @param {string} userId
   * @returns {Promise<number>} the practice games counted for the player
   */
  countOf(userId) {
    return this.#repository.countOf(userId);
  }

  /**
   * The game played again from its seed: every move must be legal, and the last one must end it.
   * @param {PracticeReport} report
   * @param {readonly DeckList[]} decks
   * @param {import("@magic8/engine/domain/content/GameContent.js").GameContent} content
   */
  #replay(report, decks, content) {
    const players = report.players.map((seat, index) => ({ id: seat.id, name: seat.id, deckList: decks[index] }));
    const created = GameEngine.create({ rules: content.gameRules, catalog: content.catalog, effects: this.#effects, commands: createCoreCommandRegistry(), players, seed: report.seed });
    if (!created.ok) {
      throw new AppError("VALIDATION", `the game cannot be set up: ${created.error.message}`);
    }
    const engine = created.value;
    const started = engine.start();
    if (!started.ok) {
      throw new AppError("VALIDATION", `the game cannot be started: ${started.error.message}`);
    }
    report.moves.forEach((move, index) => {
      const played = engine.execute(move);
      if (!played.ok) {
        throw new AppError("VALIDATION", `move ${index + 1} does not replay: ${played.error.message}`);
      }
    });
    if (!engine.isOver) {
      throw new AppError("VALIDATION", "the game is not over");
    }
    const end = engine.getSnapshot(null);
    return Object.freeze({ winnerId: end.winnerId, endReason: /** @type {string} a finished game has a reason */ (end.endReason), turnNumber: end.turnNumber });
  }
}

/**
 * @param {string | null} winnerId null for a draw
 * @param {string} you
 * @returns {"win" | "loss" | "draw"}
 */
function resultOf(winnerId, you) {
  if (winnerId === null) {
    return "draw";
  }
  return winnerId === you ? "win" : "loss";
}

/**
 * @param {unknown} body
 * @returns {PracticeReport}
 */
function parseReport(body) {
  if (!isObject(body)) {
    throw new AppError("VALIDATION", "expected a practice game");
  }
  const { seed, you, players, moves } = /** @type {Record<string, unknown>} */ (body);
  if (typeof seed !== "string" || !SEED.test(seed)) {
    throw new AppError("VALIDATION", "invalid seed");
  }
  if (!areSeats(players)) {
    throw new AppError("VALIDATION", "invalid players");
  }
  if (typeof you !== "string" || !players.some((seat) => seat.id === you)) {
    throw new AppError("VALIDATION", "invalid seat");
  }
  if (!areMoves(moves)) {
    throw new AppError("VALIDATION", "invalid moves");
  }
  return Object.freeze({ seed, you, players, moves });
}

/**
 * Two seats, each with its own id.
 * @param {unknown} value
 * @returns {value is readonly PracticeSeat[]}
 */
function areSeats(value) {
  return Array.isArray(value) && value.length === 2 && value.every(isSeat) && value[0].id !== value[1].id;
}

/**
 * @param {unknown} value
 * @returns {value is readonly Readonly<Record<string, unknown>>[]}
 */
function areMoves(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_PRACTICE_MOVES && value.every(isObject);
}

/**
 * @param {unknown} value
 * @returns {value is PracticeSeat}
 */
function isSeat(value) {
  if (!isObject(value)) {
    return false;
  }
  const { id, deck } = /** @type {Record<string, unknown>} */ (value);
  return typeof id === "string" && SEAT_ID.test(id) && Array.isArray(deck) && deck.length > 0 && deck.length <= MAX_DECK_ENTRIES && deck.every(isDeckEntry);
}

/** @param {unknown} value */
function isDeckEntry(value) {
  if (!isObject(value)) {
    return false;
  }
  const { cardId, count } = /** @type {Record<string, unknown>} */ (value);
  return typeof cardId === "string" && CARD_ID.test(cardId) && Number.isSafeInteger(count) && /** @type {number} */ (count) >= 1 && /** @type {number} */ (count) <= MAX_COPIES;
}

/**
 * A seat's deck, in the order it was sent (the shuffle starts from it), checked against the deck rules.
 * @param {PracticeSeat} seat
 * @param {import("@magic8/engine/domain/content/GameContent.js").GameContent} content
 */
function deckOf(seat, content) {
  const deck = new DeckList({ id: `deck_${seat.id}`, name: seat.id, entries: seat.deck });
  const checked = validateDeck(deck, content.deckRules, content.catalog);
  if (!checked.valid) {
    throw new AppError("VALIDATION", `the deck of ${seat.id} is not legal: ${checked.problems[0].message}`);
  }
  return deck;
}
