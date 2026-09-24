/** Registers the command handlers the engine ships with. */
import { CommandRegistry } from "./CommandRegistry.js";
import { concedeHandler } from "./handlers/ConcedeHandler.js";
import { declareAttackersHandler } from "./handlers/DeclareAttackersHandler.js";
import { declareBlockersHandler } from "./handlers/DeclareBlockersHandler.js";
import { endPhaseHandler } from "./handlers/EndPhaseHandler.js";
import { endTurnHandler } from "./handlers/EndTurnHandler.js";
import { playCardHandler } from "./handlers/PlayCardHandler.js";

/** @returns {CommandRegistry} */
export function createCoreCommandRegistry() {
  return new CommandRegistry()
    .register(playCardHandler)
    .register(declareAttackersHandler)
    .register(declareBlockersHandler)
    .register(endPhaseHandler)
    .register(endTurnHandler)
    .register(concedeHandler);
}
