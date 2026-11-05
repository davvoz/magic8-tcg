/**
 * Static abilities: continuous effects that hold while their source is on
 * the battlefield (a lord's "your verdant creatures get +1/+1"). They are
 * never queued; instead every creature's bonus is recomputed from the board
 * as part of the state-based actions, so a bonus appears the moment its
 * source enters and is gone the moment it leaves. A creature that only
 * survived on the bonus health then dies through the ordinary pipeline.
 */
import { GameEventType } from "../game/GameEventType.js";
import { TriggerType } from "./TriggerType.js";

/**
 * @param {import("../game/GameState.js").GameState} state
 * @param {import("./EffectRegistry.js").EffectRegistry} effects
 * @param {import("../game/EventLog.js").EventLog} [events] where to announce changed stats; none for a state being rebuilt
 * @returns {boolean} whether any creature's stats changed
 */
export function refreshStaticBonuses(state, effects, events) {
  const creatures = state.players.flatMap((player) => player.creatures);
  const sources = creatures.flatMap((source) => source.definition.abilitiesFor(TriggerType.STATIC).map((ability) => ({ source, ability })));
  let changed = false;
  for (const creature of creatures) {
    const bonus = { attack: 0, health: 0 };
    for (const { source, ability } of sources) {
      const given = effects.get(ability.effect)?.bonus?.(ability.params, source, creature) ?? null;
      bonus.attack += given?.attack ?? 0;
      bonus.health += given?.health ?? 0;
    }
    const before = creature.staticBonus;
    if (creature.setStaticBonus(bonus)) {
      changed = true;
      events?.emit(GameEventType.STATS_MODIFIED, {
        targetId: creature.instanceId,
        attack: bonus.attack - before.attack,
        health: bonus.health - before.health,
        duration: "static",
        attackNow: creature.attack,
        healthNow: creature.health,
      });
    }
  }
  return changed;
}
