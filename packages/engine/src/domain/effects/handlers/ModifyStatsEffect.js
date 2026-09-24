/**
 * modify_stats: adds `attack`/`health` to a creature, permanently or until
 * end of turn. Health modifiers can be negative; a creature whose health
 * drops to zero dies through state-based actions.
 */
import { GameEventType } from "../../game/GameEventType.js";
import { Targeting } from "../EffectRegistry.js";
import { TargetKind } from "../TargetSpec.js";

export const StatDuration = Object.freeze({
  PERMANENT: "permanent",
  END_OF_TURN: "end_of_turn",
});

export const modifyStatsEffect = Object.freeze({
  type: "modify_stats",
  targeting: Targeting.REQUIRED,
  targetKinds: Object.freeze([TargetKind.CREATURE]),
  params: Object.freeze({
    attack: Object.freeze({ kind: "integer", min: -10, max: 10, default: 0 }),
    health: Object.freeze({ kind: "integer", min: -10, max: 10, default: 0 }),
    duration: Object.freeze({ kind: "enum", values: Object.freeze(Object.values(StatDuration)), default: StatDuration.PERMANENT }),
  }),
  /** @param {import("../EffectContext.js").EffectContext} context */
  resolve(context) {
    const modifier = {
      attack: /** @type {number} */ (context.params.attack),
      health: /** @type {number} */ (context.params.health),
      duration: /** @type {string} */ (context.params.duration),
    };
    for (const creature of context.targetCreatures) {
      creature.addModifier(modifier);
      context.emit(GameEventType.STATS_MODIFIED, {
        targetId: creature.instanceId,
        ...modifier,
        attackNow: creature.attack,
        healthNow: creature.health,
      });
    }
  },
});
