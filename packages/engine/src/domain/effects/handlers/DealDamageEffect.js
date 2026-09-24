/** deal_damage: deals `amount` damage to each target (creature or player). */
import { Targeting } from "../EffectRegistry.js";

export const dealDamageEffect = Object.freeze({
  type: "deal_damage",
  targeting: Targeting.REQUIRED,
  params: Object.freeze({
    amount: Object.freeze({ kind: "integer", min: 1, max: 20 }),
  }),
  /** @param {import("../EffectContext.js").EffectContext} context */
  resolve(context) {
    const amount = /** @type {number} */ (context.params.amount);
    for (const creature of context.targetCreatures) {
      context.damageCreature(creature, amount);
    }
    for (const player of context.targetPlayers) {
      context.damagePlayer(player, amount);
    }
  },
});
