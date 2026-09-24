/** Phases of a turn, in order. Transitions are defined in turn/PhaseTable.js. */
export const GamePhase = Object.freeze({
  TURN_START: "TURN_START",
  MAIN_1: "MAIN_1",
  COMBAT_ATTACKERS: "COMBAT_ATTACKERS",
  COMBAT_BLOCKERS: "COMBAT_BLOCKERS",
  COMBAT_DAMAGE: "COMBAT_DAMAGE",
  MAIN_2: "MAIN_2",
  TURN_END: "TURN_END",
});

export const GAME_PHASES = Object.freeze(Object.values(GamePhase));
