/**
 * discard: each target player discards `amount` cards at random from hand.
 * Randomness comes from the game's seeded source, so replays stay exact.
 */
import { Targeting } from "../EffectRegistry.js";
import { TargetKind } from "../TargetSpec.js";

export const discardEffect = Object.freeze({
  type: "discard",
  targeting: Targeting.REQUIRED,
  targetKinds: Object.freeze([TargetKind.PLAYER]),
  params: Object.freeze({
    amount: Object.freeze({ kind: "integer", min: 1, max: 5 }),
  }),
  /** @param {import("../EffectContext.js").EffectContext} context */
  resolve(context) {
    const amount = /** @type {number} */ (context.params.amount);
    for (const player of context.targetPlayers) {
      context.discardRandom(player, amount);
    }
  },
});
