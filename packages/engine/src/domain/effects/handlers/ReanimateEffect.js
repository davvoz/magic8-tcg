/**
 * reanimate: the top `amount` creatures of the controller's graveyard (the
 * last ones to get there) return to the battlefield under their control.
 * Spells in between are skipped. They come back as if freshly played
 * (summoning sickness, match conditions) but do not fire their play
 * abilities: they were not played. Stops early when the battlefield is full.
 */
import { Targeting } from "../EffectRegistry.js";

export const reanimateEffect = Object.freeze({
  type: "reanimate",
  targeting: Targeting.NONE,
  params: Object.freeze({
    amount: Object.freeze({ kind: "integer", min: 1, max: 5 }),
  }),
  /** @param {import("../EffectContext.js").EffectContext} context */
  resolve(context) {
    context.reanimateCreatures(context.controller, /** @type {number} */ (context.params.amount));
  },
});
