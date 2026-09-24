/**
 * An effect waiting in the EffectQueue: what to do, who caused it, and which
 * targets were chosen (instance ids or player ids). Plain frozen data.
 */

/**
 * @typedef {Readonly<{
 *   effect: string,
 *   params: Readonly<Record<string, number | string>>,
 *   trigger: string,
 *   sourceId: string,
 *   sourceDefinitionId: string,
 *   controllerId: string,
 *   targetIds: readonly string[],
 * }>} PendingEffect
 */

/**
 * @param {{ ability: import("../cards/Ability.js").Ability, source: import("../cards/CardInstance.js").CardInstance, targetIds: readonly string[] }} fields
 * @returns {PendingEffect}
 */
export function createPendingEffect({ ability, source, targetIds }) {
  return Object.freeze({
    effect: ability.effect,
    params: ability.params,
    trigger: ability.trigger,
    sourceId: source.instanceId,
    sourceDefinitionId: source.definitionId,
    controllerId: source.controllerId,
    targetIds: Object.freeze([...targetIds]),
  });
}
