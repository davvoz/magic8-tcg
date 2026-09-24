/** When an ability fires. */
export const TriggerType = Object.freeze({
  /** A creature entered the battlefield from hand. Targets are chosen by the player. */
  ON_PLAY: "on_play",
  /** A spell was cast. Targets are chosen by the player. */
  ON_CAST: "on_cast",
  /** A creature moved from the battlefield to the graveyard. Targets must be automatic. */
  ON_DEATH: "on_death",
  /** The controller's turn began while the creature was on the battlefield. Targets must be automatic. */
  ON_TURN_START: "on_turn_start",
});

export const TRIGGER_TYPES = Object.freeze(Object.values(TriggerType));

/** Triggers whose targets are chosen by the player at command time. */
export const PLAYER_TARGETED_TRIGGERS = Object.freeze([TriggerType.ON_PLAY, TriggerType.ON_CAST]);
