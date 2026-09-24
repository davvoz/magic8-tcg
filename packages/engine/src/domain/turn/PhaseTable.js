/**
 * Declarative description of the turn structure: for each phase, who acts,
 * whether it resolves automatically, which commands are legal, what comes
 * next, and when it is skipped. TurnManager interprets this table; nothing
 * else hardcodes phase order.
 */
import { CommandType } from "../commands/CommandType.js";
import { GamePhase } from "../game/GamePhase.js";

export const PhaseActor = Object.freeze({
  ACTIVE: "active",
  DEFENDER: "defender",
});

/**
 * Named predicates a phase may be skipped on. Kept as a closed set so the
 * table stays data-like and reviewable.
 * @type {Readonly<Record<string, (state: import("../game/GameState.js").GameState, rules: import("../game/GameRules.js").GameRules) => boolean>>}
 */
const SKIP_PREDICATES = Object.freeze({
  no_attackers: (state) => !state.combat.hasAttackers,
  blockers_disabled: (state, rules) => !rules.combat.blockersEnabled,
});

/**
 * @typedef {object} PhaseEntry
 * @property {string | null} actor Who the phase waits on; null for automatic phases.
 * @property {boolean} automatic Resolves without a command.
 * @property {readonly string[]} allows Command types legal for the actor.
 * @property {string} next Phase entered after this one (subject to skips).
 * @property {readonly string[]} skipWhen Names in SKIP_PREDICATES; any true → phase skipped.
 */

/** @type {Readonly<Record<string, Readonly<PhaseEntry>>>} */
export const PHASE_TABLE = Object.freeze({
  [GamePhase.TURN_START]: Object.freeze({
    actor: null,
    automatic: true,
    allows: Object.freeze([]),
    next: GamePhase.MAIN_1,
    skipWhen: Object.freeze([]),
  }),
  [GamePhase.MAIN_1]: Object.freeze({
    actor: PhaseActor.ACTIVE,
    automatic: false,
    allows: Object.freeze([CommandType.PLAY_CARD, CommandType.END_PHASE, CommandType.END_TURN]),
    next: GamePhase.COMBAT_ATTACKERS,
    skipWhen: Object.freeze([]),
  }),
  [GamePhase.COMBAT_ATTACKERS]: Object.freeze({
    actor: PhaseActor.ACTIVE,
    automatic: false,
    allows: Object.freeze([CommandType.DECLARE_ATTACKERS, CommandType.END_PHASE, CommandType.END_TURN]),
    next: GamePhase.COMBAT_BLOCKERS,
    skipWhen: Object.freeze([]),
  }),
  [GamePhase.COMBAT_BLOCKERS]: Object.freeze({
    actor: PhaseActor.DEFENDER,
    automatic: false,
    allows: Object.freeze([CommandType.DECLARE_BLOCKERS]),
    next: GamePhase.COMBAT_DAMAGE,
    skipWhen: Object.freeze(["no_attackers", "blockers_disabled"]),
  }),
  [GamePhase.COMBAT_DAMAGE]: Object.freeze({
    actor: null,
    automatic: true,
    allows: Object.freeze([]),
    next: GamePhase.MAIN_2,
    skipWhen: Object.freeze(["no_attackers"]),
  }),
  [GamePhase.MAIN_2]: Object.freeze({
    actor: PhaseActor.ACTIVE,
    automatic: false,
    allows: Object.freeze([CommandType.PLAY_CARD, CommandType.END_PHASE, CommandType.END_TURN]),
    next: GamePhase.TURN_END,
    skipWhen: Object.freeze([]),
  }),
  [GamePhase.TURN_END]: Object.freeze({
    actor: null,
    automatic: true,
    allows: Object.freeze([]),
    next: GamePhase.TURN_START,
    skipWhen: Object.freeze([]),
  }),
});

/**
 * @param {string} phase
 * @returns {Readonly<PhaseEntry>}
 */
export function phaseEntry(phase) {
  const entry = PHASE_TABLE[phase];
  if (entry === undefined) {
    throw new RangeError(`PhaseTable: unknown phase "${phase}"`);
  }
  return entry;
}

/**
 * @param {string} phase
 * @param {import("../game/GameState.js").GameState} state
 * @param {import("../game/GameRules.js").GameRules} rules
 */
export function isPhaseSkipped(phase, state, rules) {
  return phaseEntry(phase).skipWhen.some((name) => SKIP_PREDICATES[name](state, rules));
}

/**
 * The phase that follows `phase`, skipping phases whose skip predicate holds.
 * @param {string} phase
 * @param {import("../game/GameState.js").GameState} state
 * @param {import("../game/GameRules.js").GameRules} rules
 */
export function nextPhaseAfter(phase, state, rules) {
  let candidate = phaseEntry(phase).next;
  let guard = 0;
  while (isPhaseSkipped(candidate, state, rules) && guard < Object.keys(PHASE_TABLE).length) {
    candidate = phaseEntry(candidate).next;
    guard += 1;
  }
  return candidate;
}

/**
 * Resolves the phase actor to a player id.
 * @param {string} phase
 * @param {import("../game/GameState.js").GameState} state
 * @returns {string | null}
 */
export function actorFor(phase, state) {
  const { actor } = phaseEntry(phase);
  if (actor === PhaseActor.ACTIVE) {
    return state.activePlayerId;
  }
  if (actor === PhaseActor.DEFENDER) {
    return state.opponentOf(state.activePlayerId).id;
  }
  return null;
}
