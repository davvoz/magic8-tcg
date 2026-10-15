/**
 * Any of the engine's AIs (an AiPolicy: BasicAi, SearchAi) as the
 * controller of a seat in a local match. The decisions are the engine's, so
 * the server plays the very same AI where it seats one.
 */
import { ControllerKind } from "./PlayerController.contract.js";

export class AiController {
  kind = ControllerKind.AI;
  #policy;

  /** @param {import("@magic8/engine/domain/ai/AiPolicy.contract.js").AiPolicy} policy */
  constructor(policy) {
    this.#policy = policy;
  }

  /**
   * @param {import("@magic8/engine/domain/ai/AiPolicy.contract.js").Snapshot} snapshot
   * @returns {Readonly<Record<string, unknown>> | null}
   */
  decide(snapshot) {
    return this.#policy.decide(snapshot);
  }
}
