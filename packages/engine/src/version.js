/**
 * Version of the rules engine. Recorded games name it (GAME_CREATED `eng`),
 * so a replay runs the same rules; it must change whenever a rule change
 * could change the outcome of a recorded game. Kept equal to package.json
 * (checked by test/architecture/moduleLoad.test.js).
 */
export const ENGINE_VERSION = "0.1.0";
