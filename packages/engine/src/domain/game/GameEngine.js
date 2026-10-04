/**
 * The only mutator of GameState.
 *
 * Pipeline for `execute(command)`:
 *   1. game over?                    → GAME_OVER
 *   2. structural shape              → INVALID_COMMAND
 *   3. player known?                 → UNKNOWN_PLAYER
 *   4. handler registered?           → UNSUPPORTED_COMMAND
 *   5. priority + phase legality     → NOT_YOUR_TURN / NOT_ALLOWED_IN_PHASE
 *   6. handler.validate              → handler-specific code
 *   7. transaction: clone state → handler.execute → settle (effect queue +
 *      state-based actions) → automatic phases → commit. Any throw (including bound overflows)
 *      discards the clone; the committed state is never half-applied.
 *
 * The engine hands out only snapshots (plain frozen data), never entities.
 */
import { fail, ok } from "../../shared/Result.js";
import { CommandError } from "../commands/CommandError.js";
import { validateCommandShape } from "../commands/validateCommandShape.js";
import { createResourceSystem } from "../resources/IncrementalResourceSystem.js";
import { ChaChaRandom } from "../random/ChaChaRandom.js";
import { phaseEntry } from "../turn/PhaseTable.js";
import { TurnManager } from "../turn/TurnManager.js";
import { EventLog } from "./EventLog.js";
import { GamePhase } from "./GamePhase.js";
import { createSnapshot } from "./GameSnapshot.js";
import { computeLegalMoves } from "./LegalMoves.js";
import { createInitialState } from "./MatchSetup.js";
import { digestState } from "./StateDigest.js";
import { resolveCombatDamage } from "../combat/CombatSystem.js";
import { EffectQueue } from "../effects/EffectQueue.js";
import { resolvePending } from "../effects/Resolution.js";

/**
 * @typedef {import("../../shared/Result.js").Ok<Readonly<{ events: readonly Readonly<Record<string, unknown>>[], version: number }>> | import("../../shared/Result.js").Fail} CommandResult
 */

export class GameEngine {
  /** @type {import("./GameState.js").GameState} */
  #state;
  #rules;
  #catalog;
  #effects;
  #commands;
  #turnManager;
  #started = false;

  /**
   * Prefer GameEngine.create; this constructor exists for tests that need a prepared state.
   * @param {{ state: import("./GameState.js").GameState, rules: import("./GameRules.js").GameRules, catalog: import("../cards/CardCatalog.js").CardCatalog, effects: import("../effects/EffectRegistry.js").EffectRegistry, commands: import("../commands/CommandRegistry.js").CommandRegistry, turnManager: TurnManager }} deps
   */
  constructor({ state, rules, catalog, effects, commands, turnManager }) {
    this.#state = state;
    this.#rules = rules;
    this.#catalog = catalog;
    this.#effects = effects;
    this.#commands = commands;
    this.#turnManager = turnManager;
  }

  /**
   * @param {{ rules: import("./GameRules.js").GameRules, catalog: import("../cards/CardCatalog.js").CardCatalog, effects: import("../effects/EffectRegistry.js").EffectRegistry, commands: import("../commands/CommandRegistry.js").CommandRegistry, players: readonly import("./MatchSetup.js").PlayerSetup[], seed: string | Uint8Array | number, shuffle?: boolean }} setup
   *   `seed`: a 32-byte key (64 lowercase hex characters or bytes) for real matches; a safe integer only for tests, tools and offline practice.
   *   `shuffle`: false deals every deck in its list's order, top first (a scripted match: the tutorial); never for a real match.
   * @returns {import("../../shared/Result.js").Ok<GameEngine> | import("../../shared/Result.js").Fail}
   */
  static create({ rules, catalog, effects, commands, players, seed, shuffle = true }) {
    if (!ChaChaRandom.isValidSeed(seed)) {
      return fail(CommandError.INVALID_COMMAND, "seed must be a 32-byte key (hex or bytes) or a safe integer");
    }
    const resourceSystem = createResourceSystem(rules);
    const initial = createInitialState({ rules, catalog, resourceSystem, players, rng: ChaChaRandom.fromSeed(seed), shuffle });
    if (!initial.ok) {
      return initial;
    }
    return ok(new GameEngine({ state: initial.value, rules, catalog, effects, commands, turnManager: GameEngine.createTurnManager(rules, resourceSystem) }));
  }

  /**
   * The turn manager with the engine's phase work attached (combat damage).
   * @param {import("./GameRules.js").GameRules} rules
   * @param {import("../resources/ResourceSystem.contract.js").ResourceSystem} resourceSystem
   */
  static createTurnManager(rules, resourceSystem) {
    return new TurnManager({ rules, resourceSystem, phaseWork: { [GamePhase.COMBAT_DAMAGE]: resolveCombatDamage } });
  }

  get version() {
    return this.#state.version;
  }

  get isOver() {
    return this.#state.isOver;
  }

  /**
   * Enters the first turn. Must be called exactly once before any command.
   * @returns {CommandResult}
   */
  start() {
    if (this.#started) {
      return fail(CommandError.ENGINE_ERROR, "engine already started");
    }
    this.#started = true;
    return this.#transaction((state, context) => this.#turnManager.start(state, context));
  }

  /**
   * @param {unknown} rawCommand Untrusted command object.
   * @returns {CommandResult}
   */
  execute(rawCommand) {
    if (!this.#started) {
      return fail(CommandError.ENGINE_ERROR, "engine not started");
    }
    if (this.#state.isOver) {
      return fail(CommandError.GAME_OVER, "the game has ended");
    }
    const shape = validateCommandShape(rawCommand);
    if (!shape.ok) {
      return fail(CommandError.INVALID_COMMAND, shape.error.message, shape.error.details);
    }
    const command = shape.value;
    const playerId = /** @type {string} */ (command.playerId);
    if (this.#state.getPlayer(playerId) === undefined) {
      return fail(CommandError.UNKNOWN_PLAYER, `unknown player "${playerId}"`);
    }
    const handler = this.#commands.get(/** @type {string} */ (command.type));
    if (handler === undefined) {
      return fail(CommandError.UNSUPPORTED_COMMAND, `command "${command.type}" is not supported`);
    }
    const legality = handler.requiresPriority ? this.#checkPriority(playerId, /** @type {string} */ (command.type)) : null;
    if (legality !== null) {
      return legality;
    }
    const validation = handler.validate(this.#state, command, this.#contextFor(new EventLog(this.#rules.limits.maxEventsPerCommand)));
    if (!validation.ok) {
      return validation;
    }
    return this.#transaction((state, context) => handler.execute(state, command, context));
  }

  /**
   * @param {string | null} [perspectivePlayerId] null for an omniscient view
   */
  getSnapshot(perspectivePlayerId = null) {
    return createSnapshot(this.#state, perspectivePlayerId, this.#rules);
  }

  /**
   * Complete deterministic projection of the state, including hidden
   * information (library order, random generator state). For state
   * commitments and replay verification only; never send it to a player.
   */
  getStateDigest() {
    return digestState(this.#state);
  }

  /** @param {string} playerId */
  getLegalMoves(playerId) {
    return computeLegalMoves(this.#state, playerId, this.#rules);
  }

  /**
   * @param {string} playerId
   * @param {string} type
   * @returns {import("../../shared/Result.js").Fail | null}
   */
  #checkPriority(playerId, type) {
    if (this.#state.awaitingPlayerId !== playerId) {
      return fail(CommandError.NOT_YOUR_TURN, `player "${playerId}" is not expected to act`);
    }
    if (!phaseEntry(this.#state.phase).allows.includes(type)) {
      return fail(CommandError.NOT_ALLOWED_IN_PHASE, `"${type}" is not allowed during ${this.#state.phase}`);
    }
    return null;
  }

  /**
   * @param {EventLog} events
   * @returns {import("../commands/CommandHandler.contract.js").ExecutionContext}
   */
  #contextFor(events) {
    /** @type {import("../commands/CommandHandler.contract.js").ExecutionContext} */
    const context = {
      rules: this.#rules,
      catalog: this.#catalog,
      effects: this.#effects,
      events,
      queue: new EffectQueue(),
      turnManager: this.#turnManager,
      settle: (state) => resolvePending(state, context),
    };
    return Object.freeze(context);
  }

  /**
   * Runs `work` against a working copy and commits it only on success.
   * @param {(state: import("./GameState.js").GameState, context: import("../commands/CommandHandler.contract.js").ExecutionContext) => void} work
   * @returns {CommandResult}
   */
  #transaction(work) {
    const working = this.#state.clone();
    const events = new EventLog(this.#rules.limits.maxEventsPerCommand);
    const context = this.#contextFor(events);
    try {
      work(working, context);
      context.settle(working);
      this.#turnManager.runAutomatic(working, context);
    } catch (error) {
      return fail(CommandError.ENGINE_ERROR, error instanceof Error ? error.message : "unexpected engine failure");
    }
    working.version += 1;
    this.#state = working;
    return ok(Object.freeze({ events: events.toArray(), version: working.version }));
  }
}
