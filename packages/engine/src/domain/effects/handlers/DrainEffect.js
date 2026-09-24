/**
 * drain: deals `amount` damage to each target (creature or player) and the
 * source's controller gains life equal to the damage actually dealt, capped
 * per creature at the health it had left.
 */
import { Targeting } from "../EffectRegistry.js";

export const drainEffect = Object.freeze({
  type: "drain",
  targeting: Targeting.REQUIRED,
  params: Object.freeze({
    amount: Object.freeze({ kind: "integer", min: 1, max: 20 }),
  }),
  /** @param {import("../EffectContext.js").EffectContext} context */
  resolve(context) {
    const amount = /** @type {number} */ (context.params.amount);
    let drained = 0;
    for (const creature of context.targetCreatures) {
      // Overkill is not drained: a creature yields at most its remaining health.
      const available = Math.max(0, creature.health);
      drained += Math.min(context.damageCreature(creature, amount), available);
    }
    for (const player of context.targetPlayers) {
      drained += context.damagePlayer(player, amount);
    }
    if (drained > 0) {
      context.healPlayer(context.controller, drained);
    }
  },
});
