/**
 * What every AI in the engine is: something that, shown what one player
 * sees, says what that player does. `BasicAi` (rules) and `SearchAi`
 * (search) both are; whoever seats an AI (a local match controller, the
 * server's auto games, the simulator) depends on this and nothing else.
 *
 * An AI only ever gets a perspective snapshot, the very data a human player
 * sees, so it cannot cheat by construction; and it is deterministic: the
 * same snapshot always yields the same command, so a game it played can be
 * played again from its seed.
 *
 * @typedef {ReturnType<import("../game/GameEngine.js").GameEngine["getSnapshot"]>} Snapshot
 * @typedef {object} AiPolicy
 * @property {(snapshot: Snapshot) => Readonly<Record<string, unknown>> | null} decide
 *   the command for the perspective player, or null when it is not theirs to move
 */

export const AI_POLICY_METHODS = Object.freeze(["decide"]);
