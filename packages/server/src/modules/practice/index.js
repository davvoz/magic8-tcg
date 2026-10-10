/**
 * Practice module: games against the AI played in the browser, counted
 * toward ranked play once the server has played them again. Other modules
 * use only what is exported here.
 */
export { MAX_PRACTICE_MOVES, PracticeService } from "./application/PracticeService.js";
export { registerPracticeRoutes } from "./http/practiceRoutes.js";
export { PgPracticeRepository } from "./infrastructure/PgPracticeRepository.js";
