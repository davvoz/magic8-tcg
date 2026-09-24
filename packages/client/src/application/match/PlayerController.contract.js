/**
 * Source of commands for one seat. The session asks the controller whose
 * player the engine is waiting on; a human controller returns null (the
 * input layer will submit later), an AI returns a command, and a future
 * remote controller would return what the network delivered.
 *
 * Controllers see only their own perspective snapshot — the same data a
 * human sees — so an AI cannot cheat by construction.
 *
 * @typedef {object} PlayerController
 * @property {string} kind One of ControllerKind.
 * @property {(snapshot: ReturnType<import("@magic8/engine/domain/game/GameEngine.js").GameEngine["getSnapshot"]>) => Readonly<Record<string, unknown>> | null} decide
 */

export const ControllerKind = Object.freeze({
  HUMAN: "human",
  AI: "ai",
});

export const PLAYER_CONTROLLER_METHODS = Object.freeze(["decide"]);
