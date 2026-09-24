/** draw_card: the controller of the source draws `amount` cards. */
import { Targeting } from "../EffectRegistry.js";

export const drawCardEffect = Object.freeze({
  type: "draw_card",
  targeting: Targeting.NONE,
  params: Object.freeze({
    amount: Object.freeze({ kind: "integer", min: 1, max: 5 }),
  }),
  /** @param {import("../EffectContext.js").EffectContext} context */
  resolve(context) {
    context.drawCards(context.controller, /** @type {number} */ (context.params.amount));
  },
});
