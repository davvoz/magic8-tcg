/**
 * mill: each target player moves the top `amount` cards of their library to
 * their graveyard. Running out of cards stops the mill without fatigue.
 */
import { Targeting } from "../EffectRegistry.js";
import { TargetKind } from "../TargetSpec.js";

export const millEffect = Object.freeze({
  type: "mill",
  targeting: Targeting.REQUIRED,
  targetKinds: Object.freeze([TargetKind.PLAYER]),
  params: Object.freeze({
    amount: Object.freeze({ kind: "integer", min: 1, max: 10 }),
  }),
  /** @param {import("../EffectContext.js").EffectContext} context */
  resolve(context) {
    const amount = /** @type {number} */ (context.params.amount);
    for (const player of context.targetPlayers) {
      context.millCards(player, amount);
    }
  },
});
