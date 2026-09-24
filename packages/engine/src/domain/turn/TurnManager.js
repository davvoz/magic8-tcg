/**
 * Drives phase transitions according to PhaseTable and performs the work
 * that phases do on entry (start-of-turn readiness, resources, draw and
 * on_turn_start triggers; end-of-turn cleanup and hand limit). Combat damage is delegated to the
 * `phaseWork` hook map so CombatSystem (Increment 4) can plug in without
 * TurnManager knowing about combat rules.
 */
import { enqueueTurnStartTriggers } from "../effects/TriggerDispatcher.js";
import { EmptyLibraryMode } from "../game/GameRules.js";
import { GameEndReason, GameEventType } from "../game/GameEventType.js";
import { GamePhase } from "../game/GamePhase.js";
import { actorFor, nextPhaseAfter, phaseEntry } from "./PhaseTable.js";

/** Automatic phases can chain; this bounds the chain per command as a safety net. */
const MAX_AUTOMATIC_STEPS = 16;

/**
 * @typedef {(state: import("../game/GameState.js").GameState, context: import("../commands/CommandHandler.contract.js").ExecutionContext) => void} PhaseWork
 */

export class TurnManager {
  #rules;
  #resourceSystem;
  /** @type {Map<string, PhaseWork>} */
  #phaseWork;

  /**
   * @param {{ rules: import("../game/GameRules.js").GameRules, resourceSystem: import("../resources/ResourceSystem.contract.js").ResourceSystem, phaseWork?: Readonly<Record<string, PhaseWork>> }} deps
   */
  constructor({ rules, resourceSystem, phaseWork = {} }) {
    this.#rules = rules;
    this.#resourceSystem = resourceSystem;
    this.#phaseWork = new Map([
      [GamePhase.TURN_START, (state, context) => this.#beginTurn(state, context)],
      [GamePhase.TURN_END, (state, context) => this.#finishTurn(state, context)],
      ...Object.entries(phaseWork),
    ]);
  }

  /**
   * Enters the first turn. The state must be freshly created (TURN_START, not yet entered).
   * @param {import("../game/GameState.js").GameState} state
   * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
   */
  start(state, context) {
    context.events.emit(GameEventType.GAME_STARTED, { firstPlayerId: state.activePlayerId });
    this.#enterPhase(state, GamePhase.TURN_START, context);
    this.runAutomatic(state, context);
  }

  /**
   * Moves to the next non-skipped phase and resolves any automatic phases that follow.
   * @param {import("../game/GameState.js").GameState} state
   * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
   */
  advance(state, context) {
    this.#enterPhase(state, nextPhaseAfter(state.phase, state, this.#rules), context);
    this.runAutomatic(state, context);
  }

  /**
   * Jumps straight to the end of the current turn.
   * @param {import("../game/GameState.js").GameState} state
   * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
   */
  endTurn(state, context) {
    this.#enterPhase(state, GamePhase.TURN_END, context);
    this.runAutomatic(state, context);
  }

  /**
   * Resolves automatic phases until a phase that needs a decision (or the game ends).
   * @param {import("../game/GameState.js").GameState} state
   * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
   */
  runAutomatic(state, context) {
    let steps = 0;
    while (!state.isOver && phaseEntry(state.phase).automatic) {
      if (steps >= MAX_AUTOMATIC_STEPS) {
        throw new RangeError("TurnManager: automatic phase chain did not settle");
      }
      this.#enterPhase(state, nextPhaseAfter(state.phase, state, this.#rules), context);
      steps += 1;
    }
  }

  /**
   * Draws cards for a player, applying the empty-library rule.
   * @param {import("../game/GameState.js").GameState} state
   * @param {import("../game/Player.js").Player} player
   * @param {number} amount
   * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
   */
  drawCards(state, player, amount, context) {
    for (let drawn = 0; drawn < amount && !state.isOver; drawn += 1) {
      const card = player.library.takeTop();
      if (card === undefined) {
        this.#handleEmptyLibrary(state, player, context);
      } else {
        player.hand.add(card);
        context.events.emit(GameEventType.CARD_DRAWN, { playerId: player.id, instanceId: card.instanceId, definitionId: card.definitionId });
      }
    }
  }

  /**
   * @param {import("../game/GameState.js").GameState} state
   * @param {string} phase
   * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
   */
  #enterPhase(state, phase, context) {
    const previous = state.phase;
    state.setPhase(phase, actorFor(phase, state));
    context.events.emit(GameEventType.PHASE_CHANGED, { from: previous, to: phase, awaitingPlayerId: state.awaitingPlayerId });
    const work = this.#phaseWork.get(phase);
    if (work !== undefined) {
      work(state, context);
      context.settle(state);
    }
  }

  /**
   * @param {import("../game/GameState.js").GameState} state
   * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
   */
  #beginTurn(state, context) {
    const player = state.activePlayer;
    state.combat.clear();
    context.events.emit(GameEventType.TURN_STARTED, { turnNumber: state.turnNumber, playerId: player.id });
    for (const card of player.battlefield.cards) {
      card.ready();
    }
    if (this.#resourceSystem.onTurnStart(player.resources)) {
      context.events.emit(GameEventType.RESOURCES_CHANGED, {
        playerId: player.id,
        current: player.resources.current,
        max: player.resources.max,
      });
    }
    const skipDraw = state.turnNumber === 1 && this.#rules.firstPlayerSkipsFirstDraw;
    if (!skipDraw) {
      this.drawCards(state, player, this.#rules.cardsDrawnPerTurn, context);
    }
    enqueueTurnStartTriggers(state, context);
  }

  /**
   * @param {import("../game/GameState.js").GameState} state
   * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
   */
  #finishTurn(state, context) {
    const player = state.activePlayer;
    for (const owner of state.players) {
      for (const card of owner.battlefield.cards) {
        card.expireEndOfTurnModifiers();
      }
    }
    this.#discardToHandLimit(player, context);
    state.combat.clear();
    state.passTurn();
  }

  /**
   * Discards the most recently drawn cards until the hand fits the limit.
   * @param {import("../game/Player.js").Player} player
   * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
   */
  #discardToHandLimit(player, context) {
    while (player.hand.size > this.#rules.maxHandSize) {
      const card = player.hand.takeBottom();
      player.graveyard.add(card);
      context.events.emit(GameEventType.CARD_DISCARDED, { playerId: player.id, instanceId: card.instanceId, definitionId: card.definitionId });
    }
  }

  /**
   * @param {import("../game/GameState.js").GameState} state
   * @param {import("../game/Player.js").Player} player
   * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
   */
  #handleEmptyLibrary(state, player, context) {
    const { mode, damagePerDraw } = this.#rules.emptyLibrary;
    if (mode === EmptyLibraryMode.LOSE) {
      state.endGame(state.opponentOf(player.id).id, GameEndReason.LIFE_DEPLETED);
      context.events.emit(GameEventType.GAME_ENDED, { winnerId: state.winnerId, reason: state.endReason });
      return;
    }
    const lost = player.loseLife(damagePerDraw);
    context.events.emit(GameEventType.FATIGUE_DAMAGE, { playerId: player.id, amount: lost });
    context.events.emit(GameEventType.LIFE_CHANGED, { playerId: player.id, life: player.life, delta: -lost });
  }
}
