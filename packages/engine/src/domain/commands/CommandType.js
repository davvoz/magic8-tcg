/** Every way a player can act. Commands are plain serialisable objects (see commandFactories.js). */
export const CommandType = Object.freeze({
  PLAY_CARD: "PLAY_CARD",
  DECLARE_ATTACKERS: "DECLARE_ATTACKERS",
  DECLARE_BLOCKERS: "DECLARE_BLOCKERS",
  END_PHASE: "END_PHASE",
  END_TURN: "END_TURN",
  CONCEDE: "CONCEDE",
});

export const COMMAND_TYPES = Object.freeze(Object.values(CommandType));
