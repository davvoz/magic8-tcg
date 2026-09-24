/**
 * return_to_hand: each target creature leaves the battlefield for its
 * owner's hand. Card data narrows the target (usually to enemies); the
 * engine only requires a creature.
 */
import { Targeting } from "../EffectRegistry.js";
import { TargetKind } from "../TargetSpec.js";

export const returnToHandEffect = Object.freeze({
  type: "return_to_hand",
  targeting: Targeting.REQUIRED,
  targetKinds: Object.freeze([TargetKind.CREATURE]),
  params: Object.freeze({}),
  /** @param {import("../EffectContext.js").EffectContext} context */
  resolve(context) {
    for (const creature of context.targetCreatures) {
      context.returnToHand(creature);
    }
  },
});
