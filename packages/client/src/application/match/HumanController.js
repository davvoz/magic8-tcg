import { ControllerKind } from "./PlayerController.contract.js";

/**
 * A seat driven by the input layer. Never decides on its own; commands
 * arrive through MatchSession.submit.
 * @type {import("./PlayerController.contract.js").PlayerController}
 */
export const humanController = Object.freeze({
  kind: ControllerKind.HUMAN,
  decide: () => null,
});
