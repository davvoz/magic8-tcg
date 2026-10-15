/**
 * Daily challenges module (docs/tcg/24-sfide.md): three games a day against
 * characters the server's AI plays, a pack for winning them all. Other
 * modules use only what is exported here.
 */
export { DailyChallengeService, aiAccountOf } from "./application/DailyChallengeService.js";
export { DailyRewarder } from "./application/DailyRewarder.js";
export { ConditionScope, DailyRoster, conditionsAt, validateDailyRoster } from "./domain/DailyRoster.js";
export { DailySchedule, Rotation } from "./domain/DailySchedule.js";
export { CHALLENGES_PER_DAY, DailyTracks, TRACK_IDS, TrackId, validateDailyTracks } from "./domain/DailyTracks.js";
export { dayOf, endOf, startOf } from "./domain/dailyDay.js";
export { DAILY_TIME_POLICY } from "./domain/dailyTimePolicy.js";
export { registerDailyRoutes } from "./http/dailyRoutes.js";
export { PgDailyRepository } from "./infrastructure/PgDailyRepository.js";
