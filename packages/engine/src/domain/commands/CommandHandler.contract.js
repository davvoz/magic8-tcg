/**
 * Contract for command handlers registered in CommandRegistry.
 *
 * `validate` must not mutate state. `execute` receives a working copy of the
 * state (the engine commits it only if everything succeeds) and may throw for
 * programmer errors; expected failures are reported from `validate`.
 *
 * @typedef {object} CommandHandler
 * @property {string} type One of CommandType.
 * @property {boolean} requiresPriority When true the command is only legal for the player the phase is waiting on, and only if the phase allows the type.
 * @property {(state: import("../game/GameState.js").GameState, command: Readonly<Record<string, unknown>>, context: ExecutionContext) => import("../../shared/Result.js").Ok<unknown> | import("../../shared/Result.js").Fail} validate
 * @property {(state: import("../game/GameState.js").GameState, command: Readonly<Record<string, unknown>>, context: ExecutionContext) => void} execute
 */

/**
 * Collaborators available while executing a command.
 *
 * @typedef {object} ExecutionContext
 * @property {import("../game/GameRules.js").GameRules} rules
 * @property {import("../cards/CardCatalog.js").CardCatalog} catalog
 * @property {import("../effects/EffectRegistry.js").EffectRegistry} effects
 * @property {import("../game/EventLog.js").EventLog} events
 * @property {import("../effects/EffectQueue.js").EffectQueue} queue Pending effects of the current command.
 * @property {import("../turn/TurnManager.js").TurnManager} turnManager
 * @property {(state: import("../game/GameState.js").GameState) => void} settle Drains the effect queue and runs state-based actions until stable. Called after every unit of work that may have changed the board.
 */

export const COMMAND_HANDLER_METHODS = Object.freeze(["validate", "execute"]);
