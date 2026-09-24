/**
 * Drains the effect queue: resolve one effect, run state-based actions,
 * enqueue death triggers, repeat until nothing is pending. Bounded by
 * rules.limits.maxEffectsPerResolution; exceeding it aborts the command.
 */
import { runStateBasedActions } from "../game/StateBasedActions.js";
import { EffectContext } from "./EffectContext.js";
import { enqueueDeathTriggers } from "./TriggerDispatcher.js";

/**
 * @param {import("../game/GameState.js").GameState} state
 * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
 */
export function resolvePending(state, context) {
  const limit = context.rules.limits.maxEffectsPerResolution;
  let resolved = 0;
  for (;;) {
    enqueueDeathTriggers(runStateBasedActions(state, context), state, context);
    const pending = context.queue.dequeue();
    if (pending === undefined || state.isOver) {
      return;
    }
    if (resolved >= limit) {
      throw new RangeError(`Resolution: more than ${limit} effects in a single command`);
    }
    resolveOne(pending, state, context);
    resolved += 1;
  }
}

/**
 * @param {import("./PendingEffect.js").PendingEffect} pending
 * @param {import("../game/GameState.js").GameState} state
 * @param {import("../commands/CommandHandler.contract.js").ExecutionContext} context
 */
function resolveOne(pending, state, context) {
  const descriptor = context.effects.get(pending.effect);
  if (descriptor === undefined) {
    throw new Error(`Resolution: no handler for effect "${pending.effect}"`);
  }
  descriptor.resolve(new EffectContext(pending, state, context));
}
