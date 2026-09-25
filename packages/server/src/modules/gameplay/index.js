/**
 * Gameplay module (GameService, GameActor): authoritative games, their
 * protocol events and timers. Other modules use only what is exported here.
 */
export { GameActor, GameError, GameStatus, MAX_SPECTATORS } from "./application/GameActor.js";
export { GameService } from "./application/GameService.js";
export { DEFAULT_SEALING_POLICY, RecordSealer } from "./application/RecordSealer.js";
export { DEFAULT_TIME_POLICY } from "./domain/TurnClock.js";
export { PgGameRepository } from "./infrastructure/PgGameRepository.js";
export { registerGameRoutes } from "./http/gameRoutes.js";
export { registerGameMessages } from "./ws/gameMessages.js";
