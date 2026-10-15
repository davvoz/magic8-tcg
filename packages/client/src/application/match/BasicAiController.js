/**
 * The engine's rule-based AI (`BasicAi`) as a seat controller of a local
 * match. The rules live in the engine so the server plays auto games with
 * the very same decisions (docs/tcg/23-automatica.md).
 */
import { AiStyle, BasicAi } from "@magic8/engine/domain/ai/BasicAi.js";
import { AiController } from "./AiController.js";

export class BasicAiController extends AiController {
  /** @param {string} [style] one of AiStyle */
  constructor(style = AiStyle.BALANCED) {
    super(new BasicAi(style));
  }
}
