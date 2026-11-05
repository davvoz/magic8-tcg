/**
 * damage_faction: deals `amount` damage to every creature of `faction` on
 * the battlefield, on both sides, the caster's own included.
 */
import { Targeting } from "../EffectRegistry.js";

export const damageFactionEffect = Object.freeze({
  type: "damage_faction",
  targeting: Targeting.NONE,
  params: Object.freeze({
    amount: Object.freeze({ kind: "integer", min: 1, max: 20 }),
    faction: Object.freeze({ kind: "faction" }),
  }),
  /** @param {import("../EffectContext.js").EffectContext} context */
  resolve(context) {
    const amount = /** @type {number} */ (context.params.amount);
    for (const player of context.state.players) {
      for (const creature of player.creatures.filter((candidate) => candidate.definition.faction === context.params.faction)) {
        context.damageCreature(creature, amount);
      }
    }
  },
});
