/**
 * faction_aura (continuous, on a static ability): while its source is on the
 * battlefield, every creature of `faction` its controller controls, the
 * source included, gets `attack`/`health` more.
 */
import { Targeting } from "../EffectRegistry.js";

export const factionAuraEffect = Object.freeze({
  type: "faction_aura",
  targeting: Targeting.NONE,
  continuous: true,
  params: Object.freeze({
    faction: Object.freeze({ kind: "faction" }),
    attack: Object.freeze({ kind: "integer", min: -5, max: 5, default: 0 }),
    health: Object.freeze({ kind: "integer", min: -5, max: 5, default: 0 }),
  }),
  /**
   * @param {Readonly<Record<string, number | string>>} params
   * @param {import("../../cards/CardInstance.js").CardInstance} source
   * @param {import("../../cards/CardInstance.js").CardInstance} creature
   */
  bonus(params, source, creature) {
    if (creature.controllerId !== source.controllerId || creature.definition.faction !== params.faction) {
      return null;
    }
    return { attack: /** @type {number} */ (params.attack), health: /** @type {number} */ (params.health) };
  },
});
