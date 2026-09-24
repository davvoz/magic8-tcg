/**
 * sacrifice: each target creature is sent to its graveyard as if it had
 * died (death triggers fire). Card data restricts the target to friendly
 * creatures; the engine only requires a creature.
 */
import { Targeting } from "../EffectRegistry.js";
import { TargetKind } from "../TargetSpec.js";

export const sacrificeEffect = Object.freeze({
  type: "sacrifice",
  targeting: Targeting.REQUIRED,
  targetKinds: Object.freeze([TargetKind.CREATURE]),
  params: Object.freeze({}),
  /** @param {import("../EffectContext.js").EffectContext} context */
  resolve(context) {
    for (const creature of context.targetCreatures) {
      context.sacrificeCreature(creature);
    }
  },
});
