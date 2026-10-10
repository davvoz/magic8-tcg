/**
 * Ranking module: the season calendar, Glicko-2 ratings of ranked games,
 * fair-play flags, the leaderboard. Other modules use only what is exported here.
 */
export { AUTO, RANKED, RankingService } from "./application/RankingService.js";
export { SEASONS_CHANNEL, SeasonCalendar } from "./application/SeasonCalendar.js";
export { DEFAULT_RATING, rateGame, updateRating } from "./domain/Glicko2.js";
export { SeasonPhase, seasonAt, seasonEnd, seasonPhase, validateRankedSettings } from "./domain/RankedSettings.js";
export { registerRankingRoutes } from "./http/rankingRoutes.js";
export { registerSeasonRoutes } from "./http/seasonRoutes.js";
export { PgRankingRepository } from "./infrastructure/PgRankingRepository.js";
export { PgSeasonRepository } from "./infrastructure/PgSeasonRepository.js";
