/**
 * The single place where effect implementations are made available to the
 * engine. New effect primitives are added here (and nowhere else); new cards
 * that merely combine existing primitives need no code at all.
 */
import { EffectRegistry } from "./EffectRegistry.js";
import { damageFactionEffect } from "./handlers/DamageFactionEffect.js";
import { dealDamageEffect } from "./handlers/DealDamageEffect.js";
import { destroyEffect } from "./handlers/DestroyEffect.js";
import { discardEffect } from "./handlers/DiscardEffect.js";
import { drainEffect } from "./handlers/DrainEffect.js";
import { drawCardEffect } from "./handlers/DrawCardEffect.js";
import { factionAuraEffect } from "./handlers/FactionAuraEffect.js";
import { healEffect } from "./handlers/HealEffect.js";
import { millEffect } from "./handlers/MillEffect.js";
import { modifyStatsEffect } from "./handlers/ModifyStatsEffect.js";
import { reanimateEffect } from "./handlers/ReanimateEffect.js";
import { returnToHandEffect } from "./handlers/ReturnToHandEffect.js";
import { sacrificeEffect } from "./handlers/SacrificeEffect.js";

/** @returns {EffectRegistry} */
export function createCoreEffectRegistry() {
  return new EffectRegistry()
    .register(drawCardEffect)
    .register(dealDamageEffect)
    .register(healEffect)
    .register(modifyStatsEffect)
    .register(drainEffect)
    .register(discardEffect)
    .register(sacrificeEffect)
    .register(returnToHandEffect)
    .register(millEffect)
    .register(destroyEffect)
    .register(damageFactionEffect)
    .register(reanimateEffect)
    .register(factionAuraEffect);
}
