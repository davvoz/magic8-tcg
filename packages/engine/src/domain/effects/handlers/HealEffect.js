/**
 * heal: removes up to `amount` damage from a creature, or restores `amount`
 * life to a player (never above the starting life total).
 */
import { Targeting } from "../EffectRegistry.js";

export const healEffect = Object.freeze({
  type: "heal",
  targeting: Targeting.REQUIRED,
  params: Object.freeze({
    amount: Object.freeze({ kind: "integer", min: 1, max: 20 }),
  }),
  /** @param {import("../EffectContext.js").EffectContext} context */
  resolve(context) {
    const amount = /** @type {number} */ (context.params.amount);
    for (const creature of context.targetCreatures) {
      context.healCreature(creature, amount);
    }
    for (const player of context.targetPlayers) {
      context.healPlayer(player, amount);
    }
  },
});
