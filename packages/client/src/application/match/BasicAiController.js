/**
 * The engine's rule-based AI (`BasicAi`) as a seat controller of a local
 * match. The rules live in the engine so the server plays auto games with
 * the very same decisions (docs/tcg/23-automatica.md).
 */
import { AiStyle, BasicAi } from "@magic8/engine/domain/ai/BasicAi.js";
import { ControllerKind } from "./PlayerController.contract.js";

export class BasicAiController {
  kind = ControllerKind.AI;
  #ai;

  /** @param {string} [style] one of AiStyle */
  constructor(style = AiStyle.BALANCED) {
    this.#ai = new BasicAi(style);
  }

  /**
   * @param {ReturnType<import("@magic8/engine/domain/game/GameEngine.js").GameEngine["getSnapshot"]>} snapshot
   * @returns {Readonly<Record<string, unknown>> | null}
   */
  decide(snapshot) {
    return this.#ai.decide(snapshot);
  }
}
